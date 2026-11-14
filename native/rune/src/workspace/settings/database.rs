use super::*;

fn query(pairs: &[(&str, &str)]) -> String {
    let mut query = url::form_urlencoded::Serializer::new(String::new());
    for (key, value) in pairs {
        query.append_pair(key, value);
    }
    query.finish()
}

fn cell_text(ink: Ink, content: String) -> El {
    text(ink, content).wrap_anywhere().shrink()
}

impl Workspace {
    pub(super) fn load_database(&mut self, schema: bool) {
        let Some(backend) = self.backend.get().cloned() else {
            return;
        };
        let database = self.settings_state.database.clone();
        let mut table = self.settings_state.table.clone();
        let offset = self.settings_state.offset;
        let filter = self.settings_state.text("db-filter");
        self.settings_state.error = None;
        self.settings_state.cell = None;
        let work = async move {
            let schema = if schema {
                let path = format!(
                    "/api/databases/schema?{}",
                    query(&[("database", &database)])
                );
                Some(backend.request(Method::GET, &path, None).await?)
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
                json!({"columns": [], "rows": []})
            } else {
                let offset = offset.to_string();
                let mut pairs = vec![
                    ("database", database.as_str()),
                    ("table", table.as_str()),
                    ("offset", offset.as_str()),
                    ("limit", "50"),
                ];
                let column = schema
                    .as_ref()
                    .and_then(|s| s["objects"].as_array())
                    .into_iter()
                    .flatten()
                    .find(|o| o["name"] == table)
                    .and_then(|o| o["columns"][0]["name"].as_str());
                if !filter.is_empty()
                    && let Some(column) = column
                {
                    pairs.push(("column", column));
                    pairs.push(("filter", filter.as_str()));
                }
                let path = format!("/api/databases/rows?{}", query(&pairs));
                backend.request(Method::GET, &path, None).await?
            };
            Ok::<_, anyhow::Error>((schema, table, rows))
        };
        self.settings_state.database_task = Some(crate::task::spawn(
            work,
            |s: &mut Workspace, result, _| match result {
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
            },
        ));
    }

    pub(super) fn database_settings(&self) -> El {
        let state = &self.settings_state;
        let mut databases = row().flex_wrap().gap(ui(6.));
        for db in state
            .data
            .get("database")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let id = db["id"].as_str().unwrap_or("").to_owned();
            let exists = db["exists"] == true;
            let mut choice = selected(
                format!("database-{id}"),
                db["filename"].as_str().unwrap_or(&id),
                id == state.database,
            );
            if !exists {
                choice = choice.opacity(0.4);
            }
            databases = databases.child(choice.on_press(move |s: &mut Workspace| {
                if exists {
                    s.settings_state.database = id.clone();
                    s.settings_state.table.clear();
                    s.settings_state.offset = 0;
                    s.settings_state.schema = Value::Null;
                    s.load_database(true);
                }
            }));
        }
        let mut tables = col()
            .key("database-tables")
            .w(ui(180.))
            .max_h(ui(520.))
            .scroll(rune::ScrollSpec {
                stick_bottom: false,
            });
        for object in state.schema["objects"].as_array().into_iter().flatten() {
            let name = object["name"].as_str().unwrap_or("").to_owned();
            tables = tables.child(
                pressable(
                    row().items_center().h(ui(28.)),
                    format!("table-{name}"),
                    &name,
                    (name == state.table).then_some(0xffffff17),
                )
                .w_full()
                .clip_rounded(0.)
                .child(cell_text(Ink::small(), name.clone()))
                .on_press(move |s: &mut Workspace| {
                    s.settings_state.table = name.clone();
                    s.settings_state.offset = 0;
                    s.load_database(true);
                }),
            );
        }
        let mut tabs = row().gap(ui(8.)).mb(ui(12.));
        for (tab, label) in [("rows", "Records"), ("schema", "Schema")] {
            tabs = tabs.child(
                selected(tab, label, state.database_tab == tab)
                    .on_press(move |s: &mut Workspace| s.settings_state.database_tab = tab),
            );
        }
        let mut detail = col().grow(1.).min_w(0.).child(tabs);
        if state.database_tab == "schema" {
            detail = detail.child(self.database_schema());
        }
        if state.database_tab == "rows" {
            detail = detail
                .child(
                    row()
                        .items_center()
                        .gap(ui(8.))
                        .mb(ui(12.))
                        .child(state.field("db-filter").grow(1.))
                        .child(
                            button("Filter first column")
                                .key("apply-db-filter")
                                .on_press(|s: &mut Workspace| {
                                    s.settings_state.offset = 0;
                                    s.load_database(true);
                                }),
                        ),
                )
                .child(self.database_grid())
                .child(self.database_pager());
            if let Some(value) = &state.cell {
                detail = detail.child(
                    section("Cell value", "Read only")
                        .child(
                            button("Close")
                                .key("close-cell")
                                .on_press(|s: &mut Workspace| s.settings_state.cell = None),
                        )
                        .child(text(Ink::new(11.).mono(), value.clone()).wrap_anywhere()),
                );
            }
        }
        col()
            .child(databases)
            .child(row().gap(ui(16.)).mt(ui(20.)).child(tables).child(detail))
    }

    fn database_grid(&self) -> El {
        let state = &self.settings_state;
        let columns = state.rows["columns"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        let mut header = row().fill(rgba(0xffffff08));
        for column in &columns {
            header = header.child(col().w(ui(180.)).padding(ui(8.)).child(cell_text(
                Ink::body().weight(SEMIBOLD),
                column.as_str().unwrap_or("").to_owned(),
            )));
        }
        let mut sheet = col()
            .min_w(ui(columns.len().max(1) as f32 * 180.))
            .child(header);
        for (index, record) in state.rows["rows"]
            .as_array()
            .into_iter()
            .flatten()
            .enumerate()
        {
            let mut line = row()
                .border_sides([0., 0., 1., 0.], rgba(0xebebeb0f))
                .border_layout();
            for (column, cell) in record["cells"].as_array().into_iter().flatten().enumerate() {
                let preview = cell["value"].as_str().unwrap_or("NULL").to_owned();
                let key = record["key"].as_str().map(str::to_owned);
                let name = columns
                    .get(column)
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_owned();
                let shown = preview.clone();
                line = line.child(
                    pressable(
                        row().items_center().h(ui(28.)),
                        format!("cell-{index}-{column}"),
                        &preview,
                        None,
                    )
                    .w(ui(180.))
                    .clip_rounded(0.)
                    .child(cell_text(Ink::small(), shown))
                    .on_press(move |s: &mut Workspace| {
                        s.open_database_cell(&name, key.as_deref(), &preview)
                    }),
                );
            }
            sheet = sheet.child(line);
        }
        col()
            .key("database-grid")
            .max_h(ui(420.))
            .scroll_xy()
            .child(sheet)
    }

    fn database_pager(&self) -> El {
        let state = &self.settings_state;
        let count = state.rows["rows"].as_array().map_or(0, Vec::len) as u32;
        let mut previous =
            button("Previous")
                .key("previous-records")
                .on_press(|s: &mut Workspace| {
                    if s.settings_state.offset > 0 {
                        s.settings_state.offset = s.settings_state.offset.saturating_sub(50);
                        s.load_database(true);
                    }
                });
        if state.offset == 0 {
            previous = previous.opacity(0.4);
        }
        let mut next = button("Next")
            .key("next-records")
            .on_press(|s: &mut Workspace| {
                if s.settings_state.rows["hasMore"] == true {
                    s.settings_state.offset += 50;
                    s.load_database(true);
                }
            });
        if state.rows["hasMore"] != true {
            next = next.opacity(0.4);
        }
        row()
            .items_center()
            .gap(ui(12.))
            .mt(ui(12.))
            .child(previous)
            .child(text(
                Ink::body(),
                format!(
                    "{}–{}",
                    state.offset + u32::from(count > 0),
                    state.offset + count
                ),
            ))
            .child(next)
    }

    fn database_schema(&self) -> El {
        let state = &self.settings_state;
        let object = state.schema["objects"]
            .as_array()
            .into_iter()
            .flatten()
            .find(|o| o["name"] == state.table.as_str())
            .unwrap_or(&Value::Null);
        let mut columns = section("Columns", state.table.clone());
        for column in object["columns"].as_array().into_iter().flatten() {
            columns = columns.child(
                setting_row(column["name"].as_str().unwrap_or("")).child(
                    text(
                        Ink::body(),
                        format!(
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
                        ),
                    )
                    .shrink(),
                ),
            );
        }
        let mut schema = col()
            .child(columns)
            .child(section("Definition", "SQL schema").child(
                text(Ink::new(11.).mono(), object["sql"].as_str().unwrap_or("")).wrap_anywhere(),
            ));
        for index in object["indexes"].as_array().into_iter().flatten() {
            schema = schema.child(
                section(index["name"].as_str().unwrap_or(""), "Index").child(text(
                    Ink::body(),
                    index["sql"].as_str().unwrap_or("Automatic index"),
                )),
            );
        }
        for key in object["foreignKeys"].as_array().into_iter().flatten() {
            schema = schema.child(
                setting_row(key["from"].as_str().unwrap_or("")).child(
                    text(
                        Ink::body(),
                        format!(
                            "→ {}.{}",
                            key["table"].as_str().unwrap_or(""),
                            key["to"].as_str().unwrap_or("")
                        ),
                    )
                    .shrink(),
                ),
            );
        }
        schema
    }

    fn open_database_cell(&mut self, column: &str, key: Option<&str>, preview: &str) {
        self.settings_state.cell = Some(preview.to_owned());
        let (Some(key), Some(backend)) = (key, self.backend.get().cloned()) else {
            return;
        };
        let path = format!(
            "/api/databases/cell?{}",
            query(&[
                ("database", &self.settings_state.database),
                ("table", &self.settings_state.table),
                ("column", column),
                ("key", key),
            ])
        );
        let work = async move { backend.request(Method::GET, &path, None).await };
        self.settings_state.database_task = Some(crate::task::spawn(
            work,
            |s: &mut Workspace, result, _| match result {
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
            },
        ));
    }
}
