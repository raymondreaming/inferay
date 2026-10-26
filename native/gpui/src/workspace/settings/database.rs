use super::*;
use crate::zoom::ui;

impl WorkspaceView {
    pub(super) fn load_database(&mut self, schema: bool, cx: &mut Context<Self>) {
        let Some(backend) = self.backend.get().cloned() else {
            return;
        };
        let database = self.settings_state.database.clone();
        let mut table = self.settings_state.table.clone();
        let offset = self.settings_state.offset;
        let filter = self.settings_state.text("db-filter", cx);
        self.settings_state.error = None;
        self.settings_state.cell = None;
        let work = cx.background_executor().spawn(async move {
            RUNTIME.block_on(async move {
                let mut query = url::form_urlencoded::Serializer::new(String::new());
                query.append_pair("database", &database);
                let schema = if schema {
                    Some(
                        backend
                            .request(
                                Method::GET,
                                &format!("/api/databases/schema?{}", query.finish()),
                                None,
                            )
                            .await?,
                    )
                } else {
                    None
                };
                if let Some(schema) = &schema
                    && !schema["objects"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .any(|o| o["name"] == table)
                {
                    table = schema["objects"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .next()
                        .and_then(|o| o["name"].as_str())
                        .unwrap_or("")
                        .to_owned();
                }
                let rows = if table.is_empty() {
                    json!({"columns":[],"rows":[]})
                } else {
                    let mut query = url::form_urlencoded::Serializer::new(String::new());
                    query
                        .append_pair("database", &database)
                        .append_pair("table", &table)
                        .append_pair("offset", &offset.to_string())
                        .append_pair("limit", "50");
                    // Filtering uses the first visible column, matching the label in the toolbar.
                    if !filter.is_empty() {
                        let column = schema
                            .as_ref()
                            .and_then(|s| s["objects"].as_array())
                            .into_iter()
                            .flatten()
                            .find(|o| o["name"] == table)
                            .and_then(|o| o["columns"][0]["name"].as_str());
                        if let Some(column) = column {
                            query
                                .append_pair("column", column)
                                .append_pair("filter", &filter);
                        }
                    }
                    backend
                        .request(
                            Method::GET,
                            &format!("/api/databases/rows?{}", query.finish()),
                            None,
                        )
                        .await?
                };
                Ok::<_, anyhow::Error>((schema, table, rows))
            })
        });
        self.settings_state.database_task = Some(cx.spawn(async move |this, cx| {
            let result = work.await;
            let _ = this.update(cx, |s, cx| {
                match result {
                    Ok((schema, table, rows)) => {
                        if let Some(schema) = schema {
                            s.settings_state.schema = schema;
                        }
                        s.settings_state.table = table;
                        s.settings_state.rows = rows;
                    }
                    Err(error) => {
                        s.settings_state.error = Some(error.to_string());
                        s.settings_state.rows = Value::Null;
                    }
                }
                cx.notify();
            });
        }));
        cx.notify();
    }
    pub(super) fn database_settings(&self, cx: &mut Context<Self>) -> AnyElement {
        let state = &self.settings_state;
        let databases = div().flex().flex_wrap().gap(ui(6.)).children(
            state
                .data
                .get("database")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .map(|db| {
                    let id = db["id"].as_str().unwrap_or("").to_owned();
                    let exists = db["exists"] == true;
                    button(
                        SharedString::from(format!("database-{id}")),
                        db["filename"].as_str().unwrap_or(&id).to_owned(),
                    )
                    .when(id == state.database, |d| d.bg(rgba(0xffffff17)))
                    .when(!exists, |d| d.opacity(0.4))
                    .on_click(cx.listener(move |s, _, _, cx| {
                        if exists {
                            s.settings_state.database = id.clone();
                            s.settings_state.table.clear();
                            s.settings_state.offset = 0;
                            s.settings_state.schema = Value::Null;
                            s.load_database(true, cx);
                        }
                    }))
                }),
        );
        let tables = div()
            .id("database-tables")
            .w(ui(180.))
            .flex_shrink_0()
            .max_h(ui(520.))
            .overflow_y_scroll()
            .children(
                state.schema["objects"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .map(|object| {
                        let name = object["name"].as_str().unwrap_or("").to_owned();
                        button(SharedString::from(format!("table-{name}")), name.clone())
                            .w_full()
                            .overflow_hidden()
                            .when(name == state.table, |d| d.bg(rgba(0xffffff17)))
                            .on_click(cx.listener(move |s, _, _, cx| {
                                s.settings_state.table = name.clone();
                                s.settings_state.offset = 0;
                                s.load_database(true, cx);
                            }))
                    }),
            );
        let tabs = div().flex().gap(ui(8.)).mb(ui(12.)).children(
            [("rows", "Records"), ("schema", "Schema")]
                .into_iter()
                .map(|(tab, label)| {
                    button(tab, label)
                        .when(state.database_tab == tab, |d| d.bg(rgba(0xffffff17)))
                        .on_click(cx.listener(move |s, _, _, cx| {
                            s.settings_state.database_tab = tab;
                            cx.notify();
                        }))
                }),
        );
        let columns = state.rows["columns"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        let header = div()
            .flex()
            .bg(rgba(0xffffff08))
            .children(columns.iter().map(|column| {
                div()
                    .w(ui(180.))
                    .flex_shrink_0()
                    .p(ui(8.))
                    .font_weight(FontWeight::SEMIBOLD)
                    .child(column.as_str().unwrap_or("").to_owned())
            }));
        let grid = div()
            .id("database-grid")
            .max_h(ui(420.))
            .overflow_scroll()
            .child(
                div()
                    .min_w(ui(columns.len().max(1) as f32 * 180.))
                    .child(header)
                    .children(
                        state.rows["rows"]
                            .as_array()
                            .into_iter()
                            .flatten()
                            .enumerate()
                            .map(|(index, record)| {
                                div()
                                    .flex()
                                    .border_b_1()
                                    .border_color(rgba(0xebebeb0f))
                                    .children(
                                        record["cells"]
                                            .as_array()
                                            .into_iter()
                                            .flatten()
                                            .enumerate()
                                            .map(|(column, cell)| {
                                                let preview = cell["value"]
                                                    .as_str()
                                                    .unwrap_or("NULL")
                                                    .to_owned();
                                                let key = record["key"].as_str().map(str::to_owned);
                                                let name = columns[column]
                                                    .as_str()
                                                    .unwrap_or("")
                                                    .to_owned();
                                                button(
                                                    SharedString::from(format!(
                                                        "cell-{index}-{column}"
                                                    )),
                                                    preview.clone(),
                                                )
                                                .w(ui(180.))
                                                .flex_shrink_0()
                                                .overflow_hidden()
                                                .on_click(cx.listener(move |s, _, _, cx| {
                                                    s.open_database_cell(
                                                        &name,
                                                        key.as_deref(),
                                                        &preview,
                                                        cx,
                                                    )
                                                }))
                                            }),
                                    )
                            }),
                    ),
            );
        let pager = div()
            .flex()
            .items_center()
            .gap(ui(12.))
            .mt(ui(12.))
            .child(
                button("previous-records", "Previous")
                    .when(state.offset == 0, |d| d.opacity(0.4))
                    .on_click(cx.listener(|s, _, _, cx| {
                        if s.settings_state.offset > 0 {
                            s.settings_state.offset = s.settings_state.offset.saturating_sub(50);
                            s.load_database(true, cx);
                        }
                    })),
            )
            .child(format!(
                "{}–{}",
                state.offset
                    + u32::from(state.rows["rows"].as_array().is_some_and(|r| !r.is_empty())),
                state.offset + state.rows["rows"].as_array().map_or(0, Vec::len) as u32
            ))
            .child(
                button("next-records", "Next")
                    .when(state.rows["hasMore"] != true, |d| d.opacity(0.4))
                    .on_click(cx.listener(|s, _, _, cx| {
                        if s.settings_state.rows["hasMore"] == true {
                            s.settings_state.offset += 50;
                            s.load_database(true, cx);
                        }
                    })),
            );
        let object = state.schema["objects"]
            .as_array()
            .into_iter()
            .flatten()
            .find(|o| o["name"] == state.table)
            .unwrap_or(&Value::Null);
        let schema = div()
            .child(
                section("Columns", state.table.clone()).children(
                    object["columns"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .map(|column| {
                            row(column["name"].as_str().unwrap_or("").to_owned()).child(format!(
                                "{}{}{}",
                                column["declaredType"].as_str().unwrap_or(""),
                                if column["primaryKeyPosition"].as_u64().unwrap_or(0) > 0 {
                                    " · Primary key"
                                } else {
                                    ""
                                },
                                if column["notNull"] == true {
                                    " · Required"
                                } else {
                                    ""
                                }
                            ))
                        }),
                ),
            )
            .child(
                section("Definition", "SQL schema").child(
                    div()
                        .font_family("Menlo")
                        .text_size(ui(11.))
                        .child(object["sql"].as_str().unwrap_or("").to_owned()),
                ),
            )
            .children(
                object["indexes"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .map(|index| {
                        section(index["name"].as_str().unwrap_or("").to_owned(), "Index").child(
                            index["sql"]
                                .as_str()
                                .unwrap_or("Automatic index")
                                .to_owned(),
                        )
                    }),
            )
            .children(
                object["foreignKeys"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .map(|key| {
                        row(key["from"].as_str().unwrap_or("").to_owned()).child(format!(
                            "→ {}.{}",
                            key["table"].as_str().unwrap_or(""),
                            key["to"].as_str().unwrap_or("")
                        ))
                    }),
            );
        let detail = div()
            .flex()
            .flex_col()
            .flex_1()
            .min_w_0()
            .child(tabs)
            .when(state.database_tab == "schema", |d| d.child(schema))
            .when(state.database_tab == "rows", |d| {
                d.child(
                    div()
                        .flex()
                        .items_center()
                        .gap(ui(8.))
                        .mb(ui(12.))
                        .child(state.field("db-filter"))
                        .child(button("apply-db-filter", "Filter first column").on_click(
                            cx.listener(|s, _, _, cx| {
                                s.settings_state.offset = 0;
                                s.load_database(true, cx);
                            }),
                        )),
                )
                .child(grid)
                .child(pager)
                .when_some(state.cell.clone(), |d, text| {
                    d.child(
                        section("Cell value", "Read only")
                            .child(button("close-cell", "Close").on_click(cx.listener(
                                |s, _, _, cx| {
                                    s.settings_state.cell = None;
                                    cx.notify();
                                },
                            )))
                            .child(div().font_family("Menlo").text_size(ui(11.)).child(text)),
                    )
                })
            });
        div()
            .child(databases)
            .child(
                div()
                    .flex()
                    .gap(ui(16.))
                    .mt(ui(20.))
                    .child(tables)
                    .child(detail),
            )
            .into_any_element()
    }
    fn open_database_cell(
        &mut self,
        column: &str,
        key: Option<&str>,
        preview: &str,
        cx: &mut Context<Self>,
    ) {
        self.settings_state.cell = Some(preview.to_owned());
        if let (Some(key), Some(backend)) = (key, self.backend.get().cloned()) {
            let mut query = url::form_urlencoded::Serializer::new(String::new());
            query
                .append_pair("database", &self.settings_state.database)
                .append_pair("table", &self.settings_state.table)
                .append_pair("column", column)
                .append_pair("key", key);
            let path = format!("/api/databases/cell?{}", query.finish());
            let work = cx
                .background_executor()
                .spawn(async move { RUNTIME.block_on(backend.request(Method::GET, &path, None)) });
            self.settings_state.database_task = Some(cx.spawn(async move |this, cx| {
                let result = work.await;
                let _ = this.update(cx, |s, cx| {
                    match result {
                        Ok(cell) => {
                            s.settings_state.cell = Some(format!(
                                "{}{}",
                                cell["value"].as_str().unwrap_or("NULL"),
                                if cell["truncated"] == true {
                                    "\n… value continues beyond this preview"
                                } else {
                                    ""
                                }
                            ))
                        }
                        Err(error) => s.settings_state.error = Some(error.to_string()),
                    }
                    cx.notify();
                });
            }));
        }
        cx.notify();
    }
}
