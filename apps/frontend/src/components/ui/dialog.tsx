import * as React from "react";
import { cn } from "@/lib/utils";
import { XIcon } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

function Dialog({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

const dialogOverlayClass =
  "fixed inset-0 z-50 bg-overlay data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0";
const dialogSurfaceClass =
  "fixed top-1/2 left-1/2 z-50 -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border-strong bg-card shadow-panel outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0";
const centeredDialogClass =
  "flex max-h-[85vh] w-[clamp(440px,33.333vw,560px)] flex-col gap-4 p-5 [@media(width<640px)]:w-[calc(100vw-32px)]";
const dialogTitleClass = "pt-1 text-base leading-5 font-semibold wrap-anywhere";
const dialogDescriptionClass = "text-sm text-muted-foreground";
const wideDialogClass = "w-[clamp(560px,60vw,960px)]";

/** The opener of a dialog that unmounted in the render now committing; see DialogSurface. */
let replacedOpener: HTMLElement | null = null;

function DialogSurface({
  className,
  children,
  presentation = "dialog",
  showCloseButton = false,
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean;
  /** Large workspaces fade without scaling their canvas or blurring the live Run behind them. */
  presentation?: "dialog" | "workspace";
}) {
  // Controlled dialogs here have no DialogTrigger, so Radix would restore focus to nothing.
  // Return focus to whatever had it when the dialog opened instead; a dialog that stays mounted
  // while closed opens many times.
  const opener = React.useRef<HTMLElement | null>(null);
  // A dialog replaced by another in one render, such as a refused Change owner opening
  // Duplicate, hands its opener on: its own focus left the page with it.
  React.useEffect(
    () => () => {
      replacedOpener = opener.current;
      queueMicrotask(() => {
        replacedOpener = null;
      });
    },
    [],
  );
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        data-slot="dialog-overlay"
        className={cn(dialogOverlayClass, presentation !== "workspace" && "backdrop-blur-[2px]")}
      />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        data-presentation={presentation}
        className={cn(
          dialogSurfaceClass,
          presentation !== "workspace" &&
            "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          className,
        )}
        onOpenAutoFocus={(event) => {
          const active = document.activeElement;
          opener.current =
            active instanceof HTMLElement && active !== document.body ? active : replacedOpener;
          onOpenAutoFocus?.(event);
        }}
        onCloseAutoFocus={(event) => {
          onCloseAutoFocus?.(event);
          const target = opener.current;
          if (event.defaultPrevented || !target?.isConnected) return;
          event.preventDefault();
          target.focus();
        }}
        {...props}
      >
        {showCloseButton ? (
          <>
            {children}
            <DialogPrimitive.Close asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Close"
                className="absolute top-3 right-3"
              >
                <XIcon aria-hidden />
              </Button>
            </DialogPrimitive.Close>
          </>
        ) : (
          children
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

type DialogLayoutProps = {
  heading: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  closeDisabled?: boolean | undefined;
};

function DialogLayout({
  heading,
  description,
  actions,
  children,
  closeDisabled,
  Close,
}: DialogLayoutProps & { Close: typeof DialogPrimitive.Close }) {
  return (
    <>
      <header className="flex shrink-0 items-start justify-between gap-3">
        {heading}
        <div className="flex shrink-0 items-center gap-2">
          {/* Use the shared key chip when #526 lands. */}
          <kbd
            aria-hidden
            className="rounded-sm border border-border-strong px-1 py-0.5 font-sans text-2xs leading-none text-muted-foreground"
          >
            Esc
          </kbd>
          <Tooltip>
            <TooltipTrigger asChild>
              <Close asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="size-7 text-muted-foreground"
                  aria-label="Close dialog"
                  disabled={closeDisabled}
                >
                  <XIcon aria-hidden className="size-4" strokeWidth={1.5} />
                </Button>
              </Close>
            </TooltipTrigger>
            <TooltipContent>Close (Esc)</TooltipContent>
          </Tooltip>
        </div>
      </header>
      {(description || children) && (
        <div
          data-slot="dialog-body"
          className="flex min-h-0 flex-col gap-4 overflow-y-auto [&>*]:shrink-0"
        >
          {description}
          {children}
        </div>
      )}
      {actions && <footer className="flex shrink-0 flex-wrap justify-end gap-2">{actions}</footer>}
    </>
  );
}

type CenteredDialogProps = Omit<
  React.ComponentProps<typeof DialogSurface>,
  "asChild" | "className" | "presentation" | "showCloseButton" | "title" | "onSubmit"
> &
  Omit<DialogLayoutProps, "heading"> & {
    title: React.ReactNode;
    size?: "standard" | "wide";
    onSubmit?: React.FormEventHandler<HTMLFormElement>;
  };

function DialogContent({
  title,
  size = "standard",
  description,
  actions,
  closeDisabled,
  children,
  onSubmit,
  onOpenAutoFocus,
  ...props
}: CenteredDialogProps) {
  const layout = (
    <DialogLayout
      heading={<DialogTitle className={dialogTitleClass}>{title}</DialogTitle>}
      description={description && <DialogDescription>{description}</DialogDescription>}
      actions={actions}
      closeDisabled={closeDisabled}
      Close={DialogPrimitive.Close}
    >
      {children}
    </DialogLayout>
  );
  return (
    <DialogSurface
      asChild={Boolean(onSubmit)}
      className={cn(centeredDialogClass, size === "wide" && wideDialogClass)}
      onOpenAutoFocus={(event) => {
        onOpenAutoFocus?.(event);
        if (event.defaultPrevented || !(event.target instanceof HTMLElement)) return;
        const content = event.target;
        const initial = content.querySelector<HTMLElement>(
          '[data-slot="dialog-body"] :is(input:not([type="hidden"]), select, textarea, button):enabled, footer button:enabled',
        );
        event.preventDefault();
        (initial ?? content).focus({ preventScroll: true });
      }}
      {...(!description && { "aria-describedby": undefined })}
      {...props}
    >
      {onSubmit ? <form onSubmit={onSubmit}>{layout}</form> : layout}
    </DialogSurface>
  );
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-lg leading-none font-semibold", className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(dialogDescriptionClass, className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogLayout,
  DialogSurface,
  DialogTitle,
  centeredDialogClass,
  dialogDescriptionClass,
  dialogTitleClass,
  dialogOverlayClass,
  dialogSurfaceClass,
};
