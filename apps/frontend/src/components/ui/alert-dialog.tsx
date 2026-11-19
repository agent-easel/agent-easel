import * as React from "react";
import { AlertDialog as Primitive } from "radix-ui";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import {
  DialogLayout,
  centeredDialogClass,
  dialogDescriptionClass,
  dialogOverlayClass,
  dialogSurfaceClass,
  dialogTitleClass,
} from "./dialog";

function AlertDialog(props: React.ComponentProps<typeof Primitive.Root>) {
  return <Primitive.Root {...props} />;
}

function AlertDialogContent({
  title,
  description,
  actions,
  closeDisabled,
  children,
  ...props
}: Omit<React.ComponentProps<typeof Primitive.Content>, "asChild" | "className" | "title"> & {
  title: React.ReactNode;
  description: React.ReactNode;
  actions: React.ReactNode;
  closeDisabled?: boolean;
}) {
  return (
    <Primitive.Portal>
      <Primitive.Overlay className={cn(dialogOverlayClass, "backdrop-blur-[2px]")} />
      <Primitive.Content className={cn(dialogSurfaceClass, centeredDialogClass)} {...props}>
        <DialogLayout
          heading={<Primitive.Title className={dialogTitleClass}>{title}</Primitive.Title>}
          description={
            <Primitive.Description className={dialogDescriptionClass}>
              {description}
            </Primitive.Description>
          }
          actions={actions}
          closeDisabled={closeDisabled}
          Close={Primitive.Action}
        >
          {children}
        </DialogLayout>
      </Primitive.Content>
    </Primitive.Portal>
  );
}

function AlertDialogCancel(props: React.ComponentProps<typeof Primitive.Cancel>) {
  return (
    <Button variant="outline" asChild>
      <Primitive.Cancel {...props} />
    </Button>
  );
}

export { AlertDialog, AlertDialogCancel, AlertDialogContent };
