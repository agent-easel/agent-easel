import type { ComponentProps, ReactNode } from "react";
import { ChevronRight, ExternalLink } from "lucide-react";
import { Slot } from "radix-ui";
import { cn } from "@/lib/utils";

const tones = {
  link: "text-link",
  neutral: "text-muted-foreground hover:text-foreground focus-visible:text-foreground",
} as const;

const trailingIcons = {
  none: null,
  chevron: <ChevronRight aria-hidden className="size-3.5 shrink-0" strokeWidth={1.5} />,
  external: <ExternalLink aria-hidden className="size-3.5 shrink-0" strokeWidth={1.5} />,
} as const;

// Size and leading come from the surrounding text. The ring overrides undo AppLink's own focus
// style when it is the `asChild` target, so every form shows the same 2 px outline.
const base =
  "inline-flex items-center gap-1 rounded-sm px-0.5 py-px font-medium underline-offset-auto outline-none hover:underline focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring focus-visible:outline-solid disabled:pointer-events-none disabled:opacity-50";

type TextLinkStyle = {
  /** `neutral` is secondary text that turns primary on hover and focus. */
  tone?: keyof typeof tones;
  /** `chevron` moves forward in the app; `external` leaves it or opens T3. */
  trailing?: keyof typeof trailingIcons;
  className?: string;
  children: ReactNode;
};

type TextLinkProps = TextLinkStyle &
  (
    | ({ asChild: true; href?: never } & Omit<
        ComponentProps<typeof Slot.Root>,
        keyof TextLinkStyle | "href"
      >)
    | ({ asChild?: false; href: string } & Omit<
        ComponentProps<"a">,
        keyof TextLinkStyle | "href" | "target" | "rel"
      >)
    | ({ asChild?: false; href?: never } & Omit<
        ComponentProps<"button">,
        keyof TextLinkStyle | "type"
      >)
  );

/**
 * The one inline text link or link-style action. `asChild` wraps an in-app route link (AppLink
 * and its Settings/Studio forms) so its typed route stays with it; `href` opens an external page
 * in a new tab; otherwise it is an action button that honors `disabled`.
 */
export function TextLink({
  tone = "link",
  trailing = "none",
  className,
  children,
  asChild,
  ...props
}: TextLinkProps) {
  const classes = cn(base, tones[tone], className);
  const icon = trailingIcons[trailing];
  if (asChild)
    return (
      <Slot.Root data-slot="text-link" className={classes} {...props}>
        <Slot.Slottable>{children}</Slot.Slottable>
        {icon}
      </Slot.Root>
    );
  if ("href" in props && props.href !== undefined)
    return (
      <a data-slot="text-link" className={classes} {...props} target="_blank" rel="noreferrer">
        {children}
        {icon}
      </a>
    );
  return (
    <button
      data-slot="text-link"
      type="button"
      className={classes}
      {...(props as ComponentProps<"button">)}
    >
      {children}
      {icon}
    </button>
  );
}
