use super::*;
use crate::task::testing::serial;
use rune::{Cx, Env, Key, KeyEvent, Mods, Runtime};
use std::cell::RefCell;

thread_local! {
    static SHOWN: RefCell<Option<EditDiff>> = const { RefCell::new(None) };
}

fn view(_: &Workspace, _: &mut Cx<Workspace>) -> El {
    crate::zoom::apply(crate::zoom::Zoom::default());
    SHOWN.with_borrow(|shown| {
        col()
            .w_full()
            .instant_changes()
            .child(shown.as_ref().unwrap().render("edit", Ink::body()))
    })
}

fn rect(rt: &Runtime<Workspace>, key: &str) -> Option<[f32; 4]> {
    rt.elements()
        .into_iter()
        .find(|e| !e.exiting && e.key.as_deref() == Some(key))
        .map(|e| e.rect)
}

#[test]
fn edit_rows_keep_numbers_syntax_word_changes_and_theme() {
    let edit = ChatEdit {
        file_path: "file.ts".into(),
        old_string: "/* comment\n😀 old */\nconst value = 1;\nunchanged".into(),
        new_string: "/* comment\n😀 new */\nconst value = 2;\nunchanged".into(),
    };
    let prepared = EditDiff::prepare(&edit, "vscode-black");
    let data = prepared.data.as_ref().unwrap();
    assert_eq!(data.lines.len(), 4);
    assert_eq!(data.lines[0].old_line_num, Some(2));
    assert_eq!(data.lines[2].new_line_num, Some(2));
    assert!(prepared.rows[0].highlights().iter().any(|(_, s)| s.italic));
    assert!(
        prepared.rows[1]
            .highlights()
            .iter()
            .any(|(_, s)| s.color == Some(rgb(0x569cd6)))
    );
    for row in prepared.rows.iter() {
        assert!(row.highlights().iter().any(|(_, s)| s.background.is_some()));
        assert!(
            row.highlights()
                .iter()
                .all(|(r, _)| row.content().get(r.clone()).is_some())
        );
    }
    let rethemed = prepared.retheme("contrast");
    assert!(Arc::ptr_eq(data, rethemed.data.as_ref().unwrap()));
    assert_ne!(prepared.rows[1].highlights(), rethemed.rows[1].highlights());
}

#[test]
fn long_chat_edits_are_bounded_virtualized_and_selectable() {
    let _serial = serial();
    let edit = ChatEdit {
        file_path: "file.rs".into(),
        old_string: (0..1000)
            .map(|i| format!("let before_{i} = 1;\n"))
            .collect(),
        new_string: (0..1000).map(|i| format!("let after_{i} = 2;\n")).collect(),
    };
    SHOWN.with_borrow_mut(|shown| *shown = Some(EditDiff::prepare(&edit, "vscode-black")));
    let mut rt = Runtime::new(Workspace::empty(), view, (400., 500.), Env::new(false, 1.));
    let clipboard = rune::clipboard::memory();
    rt.use_clipboard(&clipboard);
    rt.frame(1. / 60.);
    rt.frame(1. / 60.);
    let card = rect(&rt, "tool-edit-card").unwrap();
    assert!(card[3] <= 254., "{card:?}");
    assert!(card[2] <= 400.);
    assert!(rect(&rt, "edit-diff-row-0").is_some());
    assert!(rect(&rt, "edit-diff-row-500").is_none());
    let text = rect(&rt, "edit-text-edit-0").unwrap();
    let (x, y) = (text[0] + 4., text[1] + text[3] / 2.);
    rt.pointer_down(x, y);
    rt.pointer_up(x, y);
    rt.frame(1. / 60.);
    for c in ['a', 'c'] {
        rt.key(KeyEvent {
            key: Key::Command(c),
            mods: Mods {
                cmd: true,
                ..Mods::default()
            },
        });
        rt.frame(1. / 60.);
    }
    assert!(clipboard.text().unwrap().contains("before_"));
}
