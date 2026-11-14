use crate::colors::{RAISED, rgb, rgba};
use crate::ui::{border, shadow_md};
use crate::zoom::ui;
use rune::{El, Image, ImageCache, Shape, SurfaceFit, col, el};
use std::{cell::RefCell, collections::HashMap, path::PathBuf, sync::Arc};

thread_local! {
    static CACHE: ImageCache = ImageCache::new(Arc::new(|| crate::task::update(|_, _| {})));
    static IMAGES: RefCell<HashMap<PathBuf, Image>> = RefCell::new(HashMap::new());
}

pub(crate) fn image(path: &PathBuf) -> Image {
    IMAGES.with_borrow_mut(|images| {
        images
            .entry(path.clone())
            .or_insert_with(|| CACHE.with(|cache| cache.file(path, 144., 2.)))
            .clone()
    })
}

fn tape(width: f32, height: f32, alternate: bool) -> Shape {
    let slope = height * if alternate { 0.22 } else { -0.22 };
    Shape::new().fill(
        vec![
            [0., height * 0.2 + slope],
            [width, height * 0.2 - slope],
            [width, height * 0.8 - slope],
            [0., height * 0.8 + slope],
        ],
        rgba(0xd7c596a8),
    )
}

pub(crate) fn photo(path: PathBuf, id: String, compact: bool) -> El {
    let (width, height) = if compact { (80., 64.) } else { (144., 112.) };
    let alternate = id.as_bytes().last().is_some_and(|byte| byte % 2 == 0);
    let name = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    let picture = image(&path);
    let tape_width = ui(if compact { 26. } else { 38. });
    col()
        .key(id.clone())
        .w(ui(width))
        .min_w(0.)
        .h(ui(height + 12.))
        .px(ui(4.))
        .pt(ui(8.))
        .pb(ui(4.))
        .child(
            shadow_md(border(
                col()
                    .w_full()
                    .h_full()
                    .padding(ui(4.))
                    .radius(ui(3.))
                    .fill(rgb(0x36332f)),
                0xffffff24,
            ))
            .child(
                el().w_full()
                    .h_full()
                    .radius(ui(2.))
                    .clip_rounded(ui(2.))
                    .fill(rgb(RAISED))
                    .child(
                        el().key(format!("{id}-image"))
                            .role("image")
                            .label(name)
                            .pin(Some(0.), Some(0.), Some(0.), Some(0.))
                            .pixels_fit(picture.pixels(), SurfaceFit::Fill),
                    ),
            ),
        )
        .child(
            rune::canvas(tape(tape_width, ui(12.), alternate))
                .pin(
                    Some(ui(width) * if alternate { 0.5 } else { 0.24 }),
                    Some(0.),
                    None,
                    None,
                )
                .w(tape_width)
                .h(ui(12.)),
        )
}
