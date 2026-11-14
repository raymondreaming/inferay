use crate::icons;
use crate::task::Task;
use crate::ui::icon_sized;
use crate::workspace::Workspace;
use rune::El;
use std::{cell::RefCell, collections::HashMap, time::Duration};

#[cfg(test)]
mod tests;

pub const FEEDBACK: Duration = Duration::from_secs(2);

thread_local! {
    static COPIED: RefCell<HashMap<String, (u64, Task)>> = RefCell::new(HashMap::new());
}

pub fn copied(id: &str) -> bool {
    COPIED.with_borrow(|copied| copied.contains_key(id))
}

fn confirm(id: String) {
    let generation = COPIED.with_borrow(|copied| copied.get(&id).map_or(0, |(g, _)| g + 1));
    let reset = id.clone();
    let task = crate::task::spawn(
        async { tokio::time::sleep(FEEDBACK).await },
        move |_: &mut Workspace, _, _| {
            COPIED.with_borrow_mut(|copied| {
                if copied.get(&reset).is_some_and(|(g, _)| *g == generation) {
                    copied.remove(&reset);
                }
            })
        },
    );
    COPIED.with_borrow_mut(|copied| copied.insert(id, (generation, task)));
}

pub fn copy_button(id: impl Into<String>, button: El, text: impl Fn() -> String + 'static) -> El {
    let id = id.into();
    let done = copied(&id);
    let mut button = button.key(id.clone());
    if done {
        button = button.label("Copied");
    }
    button
        .child(
            icon_sized(if done { &icons::CHECK } else { &icons::COPY }, 12.).key(if done {
                "copy-confirmation"
            } else {
                "copy-ready"
            }),
        )
        .on_press_tx(move |_: &mut Workspace, tx| {
            tx.copy(text());
            confirm(id.clone());
        })
}
