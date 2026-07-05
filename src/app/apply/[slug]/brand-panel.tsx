import MatiousLogo from "@/components/matious-logo";
import { DottedSurface } from "@/components/ui/dotted-surface";

/**
 * Brand panel filling the right half of the apply pages on desktop (hidden on
 * mobile, where the form takes the full width). Shared by the form and the
 * info (closed / not-found) states so every apply-flow screen looks the same.
 */
export default function BrandPanel() {
  return (
    <div className="hidden lg:flex p-3">
      <div className="relative flex-1 rounded-3xl bg-gradient-to-br from-[#2B3A78] to-[#161C3D] flex flex-col p-10 xl:p-14 overflow-hidden">
        <DottedSurface dots="light" />
        <div className="relative z-10 flex flex-1 items-center justify-center">
          <MatiousLogo className="text-5xl xl:text-6xl text-white" />
        </div>
        <div className="relative z-10">
          <p className="text-2xl xl:text-3xl font-semibold leading-snug text-white">
            &ldquo;We believe in hiring smart, diverse, and interesting people — and giving
            them the space to do the best work of their careers.&rdquo;
          </p>
          <p className="mt-6 text-sm font-medium text-white/70">The Matious hiring team</p>
        </div>
      </div>
    </div>
  );
}
