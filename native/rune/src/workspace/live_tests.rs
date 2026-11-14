use super::*;

fn update(start: usize, messages: Vec<ChatTranscriptMessage>) -> Update {
    Update {
        total: None,
        requests: None,
        changed: Some((start, messages)),
        notice: None,
        commands: None,
        run_status: ChatRunStatus::default(),
        terminal: false,
        prior_activity: vec![],
        refresh_title: false,
        queue: None,
    }
}

fn message(id: usize, content: &str) -> ChatTranscriptMessage {
    serde_json::from_value(json!({"id":id.to_string(),"role":"assistant","content":content}))
        .unwrap()
}

#[test]
fn coalesced_suffixes_match_sequential_publication_including_clear() {
    let initial: Vec<_> = (0..6).map(|i| message(i, "original")).collect();
    for seed in 0..40 {
        let mut expected = initial.clone();
        let mut combined: Option<Update> = None;
        for step in 0..12 {
            let start = (seed * 7 + step * 11) % (expected.len() + 1);
            let suffix: Vec<_> = (0..(seed + step) % 5)
                .map(|i| message(step * 10 + i, "new"))
                .collect();
            expected.truncate(start);
            expected.extend(suffix.clone());
            let next = update(start, suffix);
            if let Some(combined) = &mut combined {
                combined.merge(next);
            } else {
                combined = Some(next);
            }
        }
        let (start, suffix) = combined.unwrap().changed.unwrap();
        let mut actual = initial.clone();
        actual.truncate(start);
        actual.extend(suffix);
        assert_eq!(actual, expected, "sequence {seed}");
    }
}

#[test]
fn coalescing_preserves_queue_refresh_and_terminal_events() {
    let mut combined = update(0, vec![message(0, "final response")]);
    combined.terminal = true;
    combined.refresh_title = true;
    combined.queue = Some(vec![json!({"id":"queued"})]);
    let mut next = update(0, vec![]);
    next.changed = None;
    next.notice = Some("disconnected".into());
    combined.merge(next);
    assert_eq!(combined.changed.unwrap().1[0].content, "final response");
    assert!(combined.prior_activity[0].1 && combined.refresh_title);
    assert_eq!(combined.queue.unwrap()[0]["id"], "queued");
    assert_eq!(combined.notice.as_deref(), Some("disconnected"));
}

#[test]
fn coalescing_keeps_the_clock_boundary_between_completed_and_queued_turns() {
    let mut current = ChatRunStatus::default();
    current.begin(100);
    let mut completed = update(0, vec![]);
    completed.terminal = true;
    let mut queued = update(0, vec![]);
    queued
        .run_status
        .observe("thinking".into(), Some(true), 300);
    completed.merge(queued);
    for (status, terminal) in completed.prior_activity {
        current.admit(status, terminal);
    }
    current.admit(completed.run_status, completed.terminal);
    assert_eq!(current.start_time, Some(300));
    assert_eq!(current.status, "thinking");
}

#[test]
#[ignore = "paired release benchmark"]
fn benchmark_stream_burst_preparation() {
    use std::hint::black_box;
    let source = "A paragraph with **bold**, `code`, and a [reference](https://example.com).\n\n"
        .repeat(128);
    let updates: Vec<_> = (0..8)
        .map(|i| update(0, vec![message(0, &format!("{source}chunk {i}"))]))
        .collect();
    let mut combined = updates[0].clone();
    for next in updates[1..].iter().cloned() {
        combined.merge(next);
    }
    assert_eq!(
        combined.changed.as_ref().unwrap().1,
        updates.last().unwrap().changed.as_ref().unwrap().1
    );
    crate::performance::compare("stream_burst_8_updates", |coalesce| {
        let mut pending = black_box(updates.clone()).into_iter();
        if coalesce {
            let mut combined = pending.next().unwrap();
            for next in pending {
                combined.merge(next);
            }
            let (start, messages) = combined.changed.unwrap();
            black_box(PreparedTranscript::prepare(
                start,
                messages.into_iter().map(std::sync::Arc::new),
                "vscode-black",
            ));
        } else {
            for next in pending {
                let (start, messages) = next.changed.unwrap();
                black_box(PreparedTranscript::prepare(
                    start,
                    messages.into_iter().map(std::sync::Arc::new),
                    "vscode-black",
                ));
            }
        }
    });
}
