//! Skill expansion policy shared by chat admission and tests.
use super::Prompt;

/// A message naming two or more skills becomes one step per skill, so each
/// runs as its own turn and finishes before the next begins. Everything
/// else stays a single step and expands exactly as it always has.
pub fn expand_chat_command_chain(
    skills: &[Prompt],
    text: &str,
    command_id: Option<&str>,
    args: Option<&str>,
) -> Vec<ChainStep> {
    let steps = match command_id {
        Some(_) => Vec::new(),
        None => command_steps(text, skills),
    };
    if steps.len() < 2 {
        return vec![ChainStep {
            text: expand_chat_commands(skills, text, command_id, args),
            display: text.to_owned(),
        }];
    }
    steps
}

/// One turn of a chained send: the prose introducing a skill, and the skill.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChainStep {
    /// What the agent receives for this turn.
    pub text: String,
    /// What the composer's queue shows, in the words the user typed.
    pub display: String,
}

fn expand_skill(skill: &Prompt, token: &str, args: &str) -> String {
    if skill.prompt_template.is_empty() {
        token.trim().to_owned()
    } else {
        skill
            .prompt_template
            .replacen("{args}", args, 1)
            .trim()
            .to_owned()
    }
}
/// Resolves a token to a skill, with the byte length of the invocation itself.
/// Reserved words and malformed tokens are text, not invocations; trailing
/// punctuation is prose, because people write "/design, then /audit".
fn resolve_command<'a>(token: &str, skills: &'a [Prompt]) -> Option<(&'a Prompt, usize)> {
    let invocation =
        token.trim_end_matches([',', '.', ';', ':', '!', '?', ')', ']', '}', '\'', '"']);
    let name = invocation.strip_prefix('/')?;
    if !name.starts_with(|c: char| c.is_ascii_alphabetic())
        || !name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
        || ["exit", "clear", "help", "agents", "goal"]
            .iter()
            .any(|local| name.eq_ignore_ascii_case(local))
    {
        return None;
    }
    skills
        .iter()
        .find(|skill| skill.command.eq_ignore_ascii_case(name))
        .map(|skill| (skill, invocation.len()))
}
/// Splits a message into one step per skill it names. English puts the
/// qualifier before the verb ("when that is done, finish with /audit"), so the
/// prose ahead of a command opens that command's step; trailing prose closes
/// the last one.
fn command_steps(text: &str, skills: &[Prompt]) -> Vec<ChainStep> {
    let mut steps: Vec<ChainStep> = Vec::new();
    let mut prompt = String::new();
    let mut source = String::new();
    for part in text.split_inclusive(char::is_whitespace) {
        let token = part.trim_end_matches(char::is_whitespace);
        source.push_str(part);
        match resolve_command(token, skills) {
            // Punctuation joining one step to the next is connective tissue;
            // it stays in the caption and out of the prompt.
            Some((skill, end)) => {
                prompt.push_str(&expand_skill(skill, &token[..end], ""));
                steps.push(ChainStep {
                    text: std::mem::take(&mut prompt).trim().to_owned(),
                    display: std::mem::take(&mut source).trim().to_owned(),
                });
            }
            None => prompt.push_str(part),
        }
    }
    if let Some(last) = steps.last_mut()
        && !prompt.trim().is_empty()
    {
        last.text = format!("{} {}", last.text, prompt.trim());
        last.display = format!("{} {}", last.display, source.trim());
    }
    steps
}
/// Expansion happens once at chat admission. Queued sends carry prepared text.
pub fn expand_chat_commands(
    skills: &[Prompt],
    text: &str,
    command_id: Option<&str>,
    args: Option<&str>,
) -> String {
    if let Some(id) = command_id {
        return skills
            .iter()
            .find(|skill| skill.id == id)
            .map(|skill| expand_skill(skill, text, args.unwrap_or("")))
            .unwrap_or_else(|| text.to_owned());
    }
    text.split_inclusive(char::is_whitespace)
        .map(|part| {
            let token = part.trim_end_matches(char::is_whitespace);
            resolve_command(token, skills)
                // Inline expansion stays strict: only a bare token is an
                // invocation, so prose mentioning "/review," is left alone.
                .filter(|(_, end)| *end == token.len())
                .map(|(skill, end)| {
                    format!("{}{}", expand_skill(skill, &token[..end], ""), &part[end..])
                })
                .unwrap_or_else(|| part.to_owned())
        })
        .collect()
}

#[cfg(test)]
mod chain_tests {
    use super::*;

    fn skills() -> Vec<Prompt> {
        ["audit", "design", "verify"]
            .iter()
            .map(|command| Prompt {
                id: (*command).into(),
                name: (*command).into(),
                description: String::new(),
                command: (*command).into(),
                prompt_template: format!("Run the {command} workflow."),
                is_built_in: false,
                created_at: 0,
                updated_at: 0,
            })
            .collect()
    }

    #[test]
    fn splits_a_message_into_one_step_per_skill() {
        let steps = command_steps(
            "hey do /design then after that i want you to /audit, and when thats done, do a final check and finish with /verify",
            &skills(),
        );
        assert_eq!(
            steps
                .iter()
                .map(|step| step.text.as_str())
                .collect::<Vec<_>>(),
            vec![
                "hey do Run the design workflow.",
                "then after that i want you to Run the audit workflow.",
                "and when thats done, do a final check and finish with Run the verify workflow.",
            ]
        );
        assert_eq!(steps[1].display, "then after that i want you to /audit,");
        assert_eq!(
            steps[2].display,
            "and when thats done, do a final check and finish with /verify"
        );
    }
}
