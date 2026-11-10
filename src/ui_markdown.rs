//! Read-only Markdown blocks rendered as native text, never HTML or remote content.

use pulldown_cmark::{Event, HeadingLevel, Parser, Tag, TagEnd};
use std::fmt::Write as _;
use zgui::prelude::*;

#[derive(Debug, PartialEq)]
struct Block {
    class: &'static str,
    text: String,
}

/// Links remain inert text and images display only their alternate text.
/// Code has no syntax highlighter and raw HTML is shown literally.
pub fn preview(markdown: &str) -> impl IntoView + use<> {
    let blocks = blocks(markdown)
        .into_iter()
        .map(|block| {
            view! {
                text(class = block.class) { {block.text} }
            }
        })
        .collect::<Vec<_>>();
    view! {
        column(class = "popup__markdown", attr:data-testid = "markdown-preview") {
            {blocks}
        }
    }
}

fn blocks(markdown: &str) -> Vec<Block> {
    let mut output = Vec::new();
    let mut text = String::new();
    let mut class = "popup__text";
    let mut lists = Vec::new();
    let mut quote_depth = 0_usize;
    for event in Parser::new(markdown) {
        match event {
            Event::Start(tag) => match tag {
                Tag::Heading { level, .. } => {
                    flush(&mut output, &mut text, class);
                    class = heading_class(level);
                }
                Tag::CodeBlock(_) => {
                    flush(&mut output, &mut text, class);
                    class = "popup__text popup__code";
                }
                Tag::Paragraph => {
                    if quote_depth > 0 {
                        class = "popup__text popup__quote";
                    }
                }
                Tag::BlockQuote(_) => {
                    flush(&mut output, &mut text, class);
                    quote_depth += 1;
                }
                Tag::List(start) => lists.push(start),
                Tag::Item => {
                    flush(&mut output, &mut text, class);
                    class = "popup__text";
                    text.push_str(&"  ".repeat(lists.len().saturating_sub(1)));
                    if let Some(Some(number)) = lists.last_mut() {
                        let _ = write!(text, "{number}. ");
                        *number = number.saturating_add(1);
                    } else {
                        text.push_str("• ");
                    }
                }
                _ => {}
            },
            Event::End(tag) => match tag {
                TagEnd::Paragraph | TagEnd::Heading(_) | TagEnd::Item | TagEnd::CodeBlock => {
                    flush(&mut output, &mut text, class);
                    class = "popup__text";
                }
                TagEnd::List(_) => {
                    lists.pop();
                }
                TagEnd::BlockQuote(_) => {
                    quote_depth = quote_depth.saturating_sub(1);
                }
                _ => {}
            },
            Event::Text(value)
            | Event::Code(value)
            | Event::Html(value)
            | Event::InlineHtml(value) => {
                text.push_str(&value);
            }
            Event::SoftBreak | Event::HardBreak => text.push('\n'),
            Event::Rule => {
                flush(&mut output, &mut text, class);
                output.push(Block {
                    class: "popup__text",
                    text: "────────".to_owned(),
                });
            }
            _ => {}
        }
    }
    flush(&mut output, &mut text, class);
    output
}

fn flush(output: &mut Vec<Block>, text: &mut String, class: &'static str) {
    if !text.is_empty() {
        output.push(Block {
            class,
            text: std::mem::take(text),
        });
    }
}

const fn heading_class(level: HeadingLevel) -> &'static str {
    match level {
        HeadingLevel::H1 => "popup__text popup__h1",
        HeadingLevel::H2 => "popup__text popup__h2",
        _ => "popup__text popup__h3",
    }
}

#[cfg(test)]
mod tests {
    use super::blocks;

    #[test]
    fn markdown_structure_has_native_heading_list_and_unhighlighted_code() {
        let rendered = blocks("# Heading\n\n- First\n- Second\n\n```rust\nlet x = 1;\n```");
        assert_eq!(rendered[0].text, "Heading");
        assert!(rendered[0].class.contains("popup__h1"));
        assert_eq!(rendered[1].text, "• First");
        assert_eq!(rendered[2].text, "• Second");
        assert_eq!(rendered[3].class, "popup__text popup__code");
        assert_eq!(rendered[3].text, "let x = 1;\n");
    }

    #[test]
    fn untrusted_html_links_and_images_are_only_text() {
        let rendered = blocks(
            "[link](https://example.invalid) ![alternate](https://example.invalid/image)\n\n<script>alert(1)</script>",
        );
        let text = rendered
            .iter()
            .map(|block| block.text.as_str())
            .collect::<String>();
        assert!(text.contains("link alternate"));
        assert!(text.contains("<script>alert(1)</script>"));
        assert!(!text.contains("https://"));
    }

    #[test]
    fn unfinished_fence_and_inline_markup_keep_streamed_content() {
        let rendered = blocks("```rust\nlet unfinished = **");
        assert_eq!(rendered[0].text, "let unfinished = **");
        assert_eq!(rendered[0].class, "popup__text popup__code");
        assert_eq!(blocks("[unfinished")[0].text, "[unfinished");
    }

    #[test]
    fn nested_ordered_and_multi_paragraph_lists_preserve_content_order() {
        let rendered = blocks("3. Parent\n\n   Continuation\n\n   - Child\n4. Next");
        let text = rendered
            .iter()
            .map(|block| block.text.as_str())
            .collect::<Vec<_>>();
        assert_eq!(text, ["3. Parent", "Continuation", "  • Child", "4. Next"]);
    }
}
