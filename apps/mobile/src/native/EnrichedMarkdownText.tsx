import { useMemo } from "react";
import { Platform, View } from "react-native";
import { EnrichedMarkdownText, type MarkdownStyle } from "react-native-enriched-markdown";
import type { SelectableMarkdownTextProps } from "@t3tools/mobile-markdown-text/types";

import { useAppearancePreferences } from "../features/settings/appearance/AppearancePreferencesProvider";

function enrichedStyle(
  style: SelectableMarkdownTextProps["textStyle"],
  dark: boolean,
): MarkdownStyle {
  const monospace = Platform.OS === "ios" ? "Menlo" : "monospace";
  const body = {
    color: style.color,
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    lineHeight: style.lineHeight,
    marginTop: 0,
    marginBottom: 8,
  };
  const heading = (level: number) => {
    const fontSize = style.headingFontSizes?.[level - 1] ?? style.fontSize * (1.6 - level * 0.1);
    return {
      ...body,
      color: style.strongColor,
      fontFamily: style.headingFontFamily,
      fontSize,
      lineHeight: fontSize * 1.35,
      marginTop: 8,
    };
  };
  return {
    paragraph: body,
    h1: heading(1),
    h2: heading(2),
    h3: heading(3),
    h4: heading(4),
    h5: heading(5),
    h6: heading(6),
    strong: { color: style.strongColor, fontFamily: style.boldFontFamily, fontWeight: "normal" },
    link: { color: style.linkColor, underline: false },
    code: {
      fontFamily: monospace,
      color: style.inlineCodeColor,
      backgroundColor: style.codeBackgroundColor,
      borderColor: "transparent",
      fontSize: style.fontSize * 0.9,
    },
    codeBlock: {
      ...body,
      color: style.codeColor,
      backgroundColor: style.codeBlockBackgroundColor,
      fontFamily: monospace,
      fontSize: style.fontSize * 0.9,
      borderRadius: 8,
      padding: 12,
      borderWidth: 1,
      borderColor: style.dividerColor,
      syntaxColors: dark
        ? {
            keyword: "#ff7b72",
            string: "#a5d6ff",
            number: "#79c0ff",
            constant: "#79c0ff",
            comment: "#8b949e",
            function: "#d2a8ff",
            type: "#ffa657",
            property: "#79c0ff",
            tag: "#7ee787",
            attribute: "#79c0ff",
          }
        : {
            keyword: "#cf222e",
            string: "#0a3069",
            number: "#0550ae",
            constant: "#0550ae",
            comment: "#6e7781",
            function: "#8250df",
            type: "#953800",
            property: "#0550ae",
            tag: "#116329",
            attribute: "#0550ae",
          },
    },
    blockquote: {
      ...body,
      color: style.mutedColor,
      borderColor: style.quoteMarkerColor,
      borderWidth: 2,
      gapWidth: 12,
    },
    list: { ...body, bulletColor: style.mutedColor, markerColor: style.mutedColor, gapWidth: 6 },
    thematicBreak: { color: style.dividerColor, height: 1, marginTop: 8, marginBottom: 8 },
    table: {
      ...body,
      borderColor: style.dividerColor,
      borderWidth: 1,
      headerFontFamily: style.boldFontFamily,
      headerTextColor: style.strongColor,
      headerBackgroundColor: style.codeBackgroundColor,
      rowEvenBackgroundColor: "transparent",
      rowOddBackgroundColor: "transparent",
      cellPaddingHorizontal: 12,
      cellPaddingVertical: 8,
    },
    taskList: {
      checkedColor: style.linkColor,
      checkedTextColor: style.color,
      borderColor: style.mutedColor,
      checkedStrikethrough: false,
    },
  };
}

// The Enriched-only spike leaves attachment renderers and chip decorations to
// future app integrations; every Markdown block goes through this native view.
export function MobileEnrichedMarkdownText(props: SelectableMarkdownTextProps) {
  const { themeAppearance } = useAppearancePreferences();
  const markdownStyle = useMemo(
    () => enrichedStyle(props.textStyle, themeAppearance === "dark"),
    [props.textStyle, themeAppearance],
  );

  return (
    <View
      style={{
        flexShrink: 1,
        minWidth: 0,
        marginTop: props.marginTop,
        marginBottom: props.marginBottom,
      }}
    >
      <EnrichedMarkdownText
        markdown={props.markdown}
        markdownStyle={markdownStyle}
        containerStyle={{ flexShrink: 1, minWidth: 0 }}
        flavor="github"
        selectable
        selectionColor={props.textStyle.selectionColor}
        selectionHandleColor={props.textStyle.selectionHandleColor}
        md4cFlags={{
          latexMath: false,
          hardSoftBreaks: props.preserveSoftBreaks ?? false,
          admonitions: false,
        }}
        enableTaskListItemToggle={false}
        spoilerOverlay="solid"
        onLinkPress={props.onLinkPress ? ({ url }) => props.onLinkPress?.(url) : undefined}
      />
    </View>
  );
}
