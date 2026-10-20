import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon, Attachment01Icon, Cancel01Icon, ComputerIcon, CommandLineIcon,
  Delete02Icon, FloppyDiskIcon, GlobeIcon, Key01Icon, Menu01Icon,
  MessageAdd01Icon, Search01Icon, SentIcon, Settings01Icon,
  PlayIcon, StopIcon, ArrowReloadHorizontalIcon, Brain01Icon,
  SmileIcon, CustomizeIcon, PanelRightCloseIcon, UserAdd01Icon, UserGroupIcon, ArrowDown01Icon, Mic01Icon,
  Link01Icon, Logout01Icon, ShieldUserIcon, UserCircleIcon, DashboardSquare01Icon, ChartLineData01Icon,
  ServerStack01Icon, UserMultipleIcon, Robot01Icon, ArrowLeft01Icon, PowerIcon, Clock01Icon, BookOpen01Icon, Plug01Icon,
} from "@hugeicons/core-free-icons";

function glyph(icon: typeof Add01Icon) {
  return function Icon({ size = 28, stroke = 1.7 }: { size?: number; stroke?: number }) {
    return <HugeiconsIcon icon={icon} size={size} strokeWidth={stroke} aria-hidden="true" />;
  };
}

export const IconPlus = glyph(Add01Icon);
export const IconPaperclip = glyph(Attachment01Icon);
export const IconX = glyph(Cancel01Icon);
export const IconComputer = glyph(ComputerIcon);
export const IconTool = glyph(CommandLineIcon);
export const IconTrash = glyph(Delete02Icon);
export const IconDeviceFloppy = glyph(FloppyDiskIcon);
export const IconWorldWww = glyph(GlobeIcon);
export const IconKey = glyph(Key01Icon);
export const IconMenu = glyph(Menu01Icon);
export const IconMessagePlus = glyph(MessageAdd01Icon);
export const IconSearch = glyph(Search01Icon);
export const IconSend2 = glyph(SentIcon);
export const IconSettings = glyph(Settings01Icon);
export const IconPlay = glyph(PlayIcon);
export const IconStop = glyph(StopIcon);
export const IconRefresh = glyph(ArrowReloadHorizontalIcon);
export const IconBrain = glyph(Brain01Icon);
export const IconReact = glyph(SmileIcon);
export const IconBotAdd = glyph(UserAdd01Icon);
export const IconCustomize = glyph(CustomizeIcon);
export const IconCollapse = glyph(PanelRightCloseIcon);
export const IconGroup = glyph(UserGroupIcon);
export const IconChevronDown = glyph(ArrowDown01Icon);
export const IconMic = glyph(Mic01Icon);
export const IconLink = glyph(Link01Icon);
export const IconLogout = glyph(Logout01Icon);
export const IconAdmin = glyph(ShieldUserIcon);
export const IconAccount = glyph(UserCircleIcon);
export const IconDashboard = glyph(DashboardSquare01Icon);
export const IconUsage = glyph(ChartLineData01Icon);
export const IconServers = glyph(ServerStack01Icon);
export const IconUsers = glyph(UserMultipleIcon);
export const IconRobot = glyph(Robot01Icon);
export const IconBack = glyph(ArrowLeft01Icon);
export const IconPower = glyph(PowerIcon);
export const IconClock = glyph(Clock01Icon);
export const IconBook = glyph(BookOpen01Icon);
export const IconPlug = glyph(Plug01Icon);
