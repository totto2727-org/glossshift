#[must_use]
pub fn translation_prompt(source: &str, target: &str, text: &str) -> String {
    format!(
        "Translate the text from {source} to {target}. Preserve meaning, tone, paragraphs, and formatting. Return the translation only, with no explanation.\n\n{text}"
    )
}

#[cfg(test)]
mod tests {
    use super::translation_prompt;

    #[test]
    fn asks_for_translation_without_extra_commentary() {
        let prompt = translation_prompt("auto", "Japanese", "Hello");
        assert!(prompt.contains("Japanese"));
        assert!(prompt.contains("Hello"));
        assert!(prompt.contains("translation only"));
    }
}
