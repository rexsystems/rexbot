import { createTheme, type MantineColorsTuple } from "@mantine/core";

const ember: MantineColorsTuple = [
  "#fff4eb",
  "#ffe5d1",
  "#ffc9a3",
  "#ffab70",
  "#f58b42",
  "#d9773a",
  "#b85f2a",
  "#944a20",
  "#6f3717",
  "#4a240f",
];

export const theme = createTheme({
  scale: 1.08,
  primaryColor: "ember",
  primaryShade: 7,
  colors: {
    ember,
    dark: ["#f0ebe3", "#d8d1c6", "#b8b2a6", "#a49d91", "#706a60", "#39352e", "#28251f", "#171614", "#11100e", "#0c0b0a"],
  },
  fontFamily: '"IBM Plex Sans", system-ui, sans-serif',
  fontFamilyMonospace: '"IBM Plex Mono", ui-monospace, monospace',
  defaultRadius: "sm",
  headings: {
    fontFamily: '"IBM Plex Sans", system-ui, sans-serif',
    fontWeight: "600",
  },
  components: {
    Button: { defaultProps: { size: "md", radius: "md" } },
    ActionIcon: { defaultProps: { size: 44, radius: "md" } },
    TextInput: { defaultProps: { size: "md" } },
    PasswordInput: { defaultProps: { size: "md" } },
    Textarea: { defaultProps: { size: "md" } },
  },
});
