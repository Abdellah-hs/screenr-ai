export { Button, type ButtonProps } from "./button";
export { Input, type InputProps } from "./input";
export { Textarea, type TextareaProps } from "./textarea";
export { Select, type SelectProps } from "./select";
export { FIELD_BASE, FIELD_ERROR, FIELD_LABEL, FIELD_ERROR_TEXT } from "./field";
export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, type CardProps } from "./card";
export { Badge, type BadgeProps } from "./badge";
export { Breadcrumb, type Crumb } from "./breadcrumb";
export { AiRail, AiCaption, AiEyebrow } from "./ai-attribution";
export {
  ScoreInline,
  ScoreAbsent,
  ScoreCard,
  ScoreSection,
  criterionVerdict,
  type CriterionVerdict,
} from "./score-block";
export { ActorMark, actorFromTransition, type Actor } from "./actor-mark";
export { Modal, ModalHeader, ModalFooter, type ModalProps } from "./modal";
export {
  AnchoredMenu,
  MenuNote,
  MENU_ITEM,
  MENU_ITEM_DANGER,
  MENU_LABEL,
} from "./anchored-menu";
export { Skeleton, SkeletonCard } from "./skeleton";
// DottedSurface is deliberately NOT re-exported here. It pulls in the whole of
// three.js, and 23 modules import this barrel for a Button or a Breadcrumb — so
// a decoration used by exactly one public page (the apply brand panel) was
// sitting in the dev compile graph of every dashboard screen. Import it from
// "@/components/ui/dotted-surface" directly.
