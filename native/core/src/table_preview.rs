use serde::Serialize;
use serde_json::Value;

const MAX_BYTES: usize = 1024 * 1024;
const MAX_ROWS: usize = 200;
const MAX_COLUMNS: usize = 64;

#[derive(Debug, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct TablePreview {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub total_rows: usize,
}

impl TablePreview {
    pub fn from_content(filename: &str, content: &str) -> Result<Option<Self>, String> {
        let extension = filename
            .rsplit('.')
            .next()
            .unwrap_or("")
            .to_ascii_lowercase();
        if !matches!(extension.as_str(), "csv" | "tsv" | "json") {
            return Ok(None);
        }
        if content.len() > MAX_BYTES {
            return Err("Table preview is limited to 1 MB.".into());
        }
        if extension == "json" {
            return Self::json(content);
        }
        let mut reader = csv::ReaderBuilder::new()
            .delimiter(if extension == "tsv" { b'\t' } else { b',' })
            .from_reader(content.as_bytes());
        let columns: Vec<String> = reader
            .headers()
            .map_err(|error| error.to_string())?
            .iter()
            .enumerate()
            .map(|(index, label)| {
                if label.is_empty() {
                    format!("Column {}", index + 1)
                } else {
                    label.into()
                }
            })
            .collect();
        if columns.is_empty() {
            return Ok(None);
        }
        if columns.len() > MAX_COLUMNS {
            return Err(
                "Table preview is limited to 64 columns. View the source for all columns.".into(),
            );
        }
        let mut table = Self {
            columns,
            rows: Vec::new(),
            total_rows: 0,
        };
        for record in reader.records() {
            let record = record.map_err(|error| format!("Cannot display this table: {error}"))?;
            table.total_rows += 1;
            if table.rows.len() < MAX_ROWS {
                table.rows.push(record.iter().map(str::to_owned).collect());
            }
        }
        Ok(Some(table))
    }

    fn json(content: &str) -> Result<Option<Self>, String> {
        let value: Value = serde_json::from_str(content)
            .map_err(|error| format!("Cannot display this JSON table: {error}"))?;
        let Some(records) = value.as_array() else {
            return Ok(None);
        };
        if records.is_empty() || !records.iter().all(Value::is_object) {
            return Ok(None);
        }
        let mut columns = Vec::new();
        for record in records {
            for key in record.as_object().expect("checked object").keys() {
                if !columns.contains(key) {
                    if columns.len() == MAX_COLUMNS {
                        return Err("Table preview is limited to 64 columns. View the source for all columns.".into());
                    }
                    columns.push(key.clone());
                }
            }
        }
        if columns.is_empty() {
            return Ok(None);
        }
        let rows = records
            .iter()
            .take(MAX_ROWS)
            .map(|record| {
                columns
                    .iter()
                    .map(|key| match record.get(key) {
                        None => String::new(),
                        Some(Value::String(text)) => text.clone(),
                        Some(value) => value.to_string(),
                    })
                    .collect()
            })
            .collect();
        Ok(Some(Self {
            columns,
            rows,
            total_rows: records.len(),
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn delimited_tables_preserve_quotes_newlines_and_literal_values() {
        let table = TablePreview::from_content("report.CSV", "\u{feff}Name,Note,Value\r\n\"One, two\",\"line 1\nline \"\"2\"\"\",001\r\n=SUM(A1),<script>,0\r\n").unwrap().unwrap();
        assert_eq!(table.columns, ["Name", "Note", "Value"]);
        assert_eq!(table.rows[0], ["One, two", "line 1\nline \"2\"", "001"]);
        assert_eq!(table.rows[1], ["=SUM(A1)", "<script>", "0"]);
        assert_eq!(table.total_rows, 2);
        let tsv = TablePreview::from_content("report.tsv", "\tValue\nrow\t42\n")
            .unwrap()
            .unwrap();
        assert_eq!(tsv.columns, ["Column 1", "Value"]);
        assert_eq!(tsv.rows[0], ["row", "42"]);
    }

    #[test]
    fn json_uses_all_column_names_and_preserves_nested_and_missing_values() {
        let table = TablePreview::from_content(
            "report.json",
            r#"[{"name":"first","value":null},{"value":false,"extra":{"ok":true}},{"value":0}]"#,
        )
        .unwrap()
        .unwrap();
        assert_eq!(table.columns, ["name", "value", "extra"]);
        assert_eq!(table.rows[0], ["first", "null", ""]);
        assert_eq!(table.rows[1], ["", "false", "{\"ok\":true}"]);
        assert_eq!(table.rows[2], ["", "0", ""]);
        for content in ["[]", "{}", "[1,2]", "[{\"a\":1},2]"] {
            assert!(
                TablePreview::from_content("report.json", content)
                    .unwrap()
                    .is_none()
            );
        }
    }

    #[test]
    fn bounds_are_explicit_and_invalid_late_records_do_not_look_complete() {
        let content = format!("Name,Value\n{}", "row,1\n".repeat(205));
        let table = TablePreview::from_content("report.csv", &content)
            .unwrap()
            .unwrap();
        assert_eq!(table.total_rows, 205);
        assert_eq!(table.rows.len(), 200);
        assert!(TablePreview::from_content("report.csv", &(content + "bad,row,extra\n")).is_err());
        assert!(TablePreview::from_content("report.csv", &vec!["column"; 65].join(",")).is_err());
        assert!(TablePreview::from_content("report.csv", &"x".repeat(MAX_BYTES + 1)).is_err());
    }
}
