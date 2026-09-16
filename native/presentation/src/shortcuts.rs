//! Repository shortcut configuration. The browser supplies event/focus facts;
//! these bindings own key matching. Feature models decide whether an action
//! is available and perform selection without knowing DOM elements.
use crate::{flag, string};
use serde_json::Value;

const META: u8 = 1;
const CTRL: u8 = 2;
const ALT: u8 = 4;
const SHIFT: u8 = 8;

// scope, key, exact modifiers, action, allow held-key repeats
const BINDINGS: &[(&str, &str, u8, &str, bool)] = &[
    ("window", "ArrowLeft", META, "previousRepository", true),
    ("window", "ArrowRight", META, "nextRepository", true),
    ("repositoryTabs", "Tab", 0, "nextRepository", true),
    ("repositoryTabs", "Tab", SHIFT, "previousRepository", true),
    ("graph", "ArrowUp", 0, "previousCommit", true),
    ("graph", "ArrowDown", 0, "nextCommit", true),
    ("graph", "ArrowUp", ALT, "previousBranchCommit", true),
    ("graph", "ArrowDown", ALT, "nextBranchCommit", true),
    ("graph", "Home", 0, "firstCommit", true),
    ("graph", "End", 0, "lastCommit", true),
    ("graph", "ArrowRight", 0, "openSelection", false),
    ("graph", "ArrowLeft", 0, "closeGraph", false),
    ("graph", " ", 0, "consume", true),
    ("sidebar", "ArrowUp", 0, "previousFile", true),
    ("sidebar", "ArrowDown", 0, "nextFile", true),
    ("sidebar", "ArrowLeft", 0, "focusGraph", false),
    ("sidebar", "ArrowRight", 0, "openFile", false),
    ("sidebar", "Enter", 0, "toggleFile", false),
    ("sidebar", " ", 0, "pageDown", true),
    ("sidebar", " ", SHIFT, "pageUp", true),
    ("diff", " ", 0, "pageDown", true),
    ("diff", " ", SHIFT, "pageUp", true),
    ("diff", "ArrowUp", 0, "previousFile", true),
    ("diff", "ArrowDown", 0, "nextFile", true),
    ("diff", "ArrowLeft", 0, "close", false),
    ("diff", "Enter", 0, "toggleFile", false),
    ("chat", "ArrowRight", 0, "enterSidebar", false),
];

pub fn action(input: &Value, scope: &str) -> Option<&'static str> {
    if flag(&input["blocked"]) || flag(&input["composing"]) {
        return None;
    }
    // Command arrows are deliberately window-wide, including chat editors.
    // Local navigation must not steal cursor movement or modal interactions.
    if scope != "window"
        && ((scope == "graph" && flag(&input["button"]))
            || flag(&input["overlay"])
            || (flag(&input["editable"]) && !(scope == "chat" && flag(&input["emptyComposer"]))))
    {
        return None;
    }
    let modifiers = u8::from(flag(&input["meta"])) * META
        | u8::from(flag(&input["ctrl"])) * CTRL
        | u8::from(flag(&input["alt"])) * ALT
        | u8::from(flag(&input["shift"])) * SHIFT;
    BINDINGS
        .iter()
        .find_map(|&(context, key, keys, action, repeat)| {
            (context == scope
                && key == string(&input["key"])
                && keys == modifiers
                && (repeat || !flag(&input["repeat"])))
            .then_some(action)
        })
}

pub fn resolve(input: &Value) -> Option<&'static str> {
    action(input, "window").or_else(|| action(input, string(&input["scope"])))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn every_binding_has_exact_modifiers_and_declared_repeat_policy() {
        for &(scope, key, modifiers, expected, repeat) in BINDINGS {
            let mut input = json!({"key":key,"meta":modifiers & META != 0,
                "ctrl":modifiers & CTRL != 0,"alt":modifiers & ALT != 0,
                "shift":modifiers & SHIFT != 0});
            assert_eq!(action(&input, scope), Some(expected), "{scope} {key}");
            input["repeat"] = json!(true);
            assert_eq!(action(&input, scope), repeat.then_some(expected));
            input["repeat"] = json!(false);
            for guard in ["blocked", "composing"] {
                input[guard] = json!(true);
                assert_eq!(action(&input, scope), None);
                input[guard] = json!(false);
            }
            input["ctrl"] = json!(true);
            assert_eq!(action(&input, scope), None);
        }
    }

    #[test]
    fn window_shortcuts_ignore_focus_but_local_shortcuts_respect_editors_and_overlays() {
        for scope in ["graph", "sidebar", "diff", "chat", "repositoryTabs"] {
            for guard in ["editable", "overlay"] {
                let mut input = json!({"scope":scope,"key":"ArrowRight","meta":true});
                input[guard] = json!(true);
                assert_eq!(resolve(&input), Some("nextRepository"));
                input["meta"] = json!(false);
                assert_eq!(resolve(&input), None);
            }
        }
        assert_eq!(
            resolve(
                &json!({"scope":"chat","key":"ArrowRight","editable":true,"emptyComposer":true})
            ),
            Some("enterSidebar")
        );
        assert_eq!(
            resolve(&json!({"scope":"chat","key":"ArrowLeft","meta":true,"shift":true})),
            None
        );
    }

    #[test]
    fn bindings_do_not_collide() {
        for (index, binding) in BINDINGS.iter().enumerate() {
            assert!(
                !BINDINGS[index + 1..]
                    .iter()
                    .any(|other| binding.0 == other.0
                        && binding.1 == other.1
                        && binding.2 == other.2)
            );
        }
    }
}
