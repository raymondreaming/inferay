//! Clipboard feedback belongs to each visible Copy control, not the conversation.
use crate::zoom::ui;
use gpui::{prelude::*, *};
use std::time::Duration;

#[derive(IntoElement)]
pub struct CopyButton {
    button: Stateful<Div>,
    text: Box<dyn Fn() -> String>,
}

struct Feedback {
    copied: bool,
    reset: Option<Task<()>>,
}

pub fn copy_button(button: Stateful<Div>, text: impl Fn() -> String + 'static) -> CopyButton {
    CopyButton {
        button,
        text: Box::new(text),
    }
}

impl RenderOnce for CopyButton {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let state =
            window.use_keyed_state(Element::id(&self.button).unwrap(), cx, |_, _| Feedback {
                copied: false,
                reset: None,
            });
        let copied = state.read(cx).copied;
        self.button
            .when(copied, |button| button.aria_label("Copied"))
            .child(
                crate::icon(if copied { "Check" } else { "Copy" })
                    .size(ui(12.))
                    .debug_selector(move || {
                        if copied {
                            "copy-confirmation"
                        } else {
                            "copy-ready"
                        }
                        .into()
                    }),
            )
            .on_click(move |_, _, cx| {
                cx.write_to_clipboard(ClipboardItem::new_string((self.text)()));
                state.update(cx, |state, cx| {
                    state.copied = true;
                    state.reset = Some(cx.spawn(async |this, cx| {
                        cx.background_executor().timer(Duration::from_secs(2)).await;
                        let _ = this.update(cx, |state, cx| {
                            state.copied = false;
                            cx.notify();
                        });
                    }));
                    cx.notify();
                });
            })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[gpui::test]
    fn copying_confirms_and_repeated_clicks_restart_feedback(cx: &mut TestAppContext) {
        struct Example;
        impl Render for Example {
            fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
                copy_button(
                    crate::button("copy-example", "")
                        .aria_label("Copy response")
                        .debug_selector(|| "copy-example".into()),
                    || "café 🌳".into(),
                )
            }
        }
        let (view, cx) = cx.add_window_view(|_, _| Example);
        let draw = |cx: &mut VisualTestContext| {
            cx.draw(point(px(0.), px(0.)), size(px(200.), px(100.)), |_, _| {
                view.clone().into_any_element()
            });
        };
        draw(cx);
        assert!(cx.debug_bounds("copy-ready").is_some());
        let button = cx.debug_bounds("copy-example").unwrap();
        cx.simulate_click(button.center(), Modifiers::default());
        cx.run_until_parked();
        draw(cx);
        assert!(cx.debug_bounds("copy-confirmation").is_some());
        assert_eq!(
            cx.read_from_clipboard()
                .and_then(|item| item.text())
                .as_deref(),
            Some("café 🌳")
        );
        cx.executor().advance_clock(Duration::from_secs(1));
        cx.run_until_parked();
        cx.simulate_click(button.center(), Modifiers::default());
        cx.run_until_parked();
        cx.executor().advance_clock(Duration::from_millis(1100));
        cx.run_until_parked();
        draw(cx);
        assert!(cx.debug_bounds("copy-confirmation").is_some());
        cx.executor().advance_clock(Duration::from_secs(1));
        cx.run_until_parked();
        draw(cx);
        assert!(cx.debug_bounds("copy-confirmation").is_none());
        assert!(cx.debug_bounds("copy-ready").is_some());
    }
}
