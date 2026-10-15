"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"
import { m } from "framer-motion"
import { SheetHandle, useSheetDrag } from "@/components/ui/SoftSheet"

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

/**
 * The app's sheet for a Radix dialog (15 Oct 2026): up from below on a phone
 * and flicked down by its handle, a centred rising card from `sm`, both the
 * keyframes SoftSheet plays (`.sheet-soft`, `.scrim-sheet`). `className` is the
 * width, `bodyClassName` the scrolling body; the slide lives on Content and the
 * drag on the card inside it, so the two never write the same transform.
 */
function SheetDialogContent({
  className,
  bodyClassName,
  overlayClassName,
  children,
  showCloseButton,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  bodyClassName?: string
  overlayClassName?: string
  showCloseButton: boolean
}) {
  const closeRef = React.useRef<HTMLButtonElement>(null)
  const { controls, dragProps } = useSheetDrag(() => closeRef.current?.click())
  return (
    <DialogPortal>
      <DialogOverlay
        className={cn("scrim-sheet bg-black/40 supports-backdrop-filter:backdrop-blur-none", overlayClassName)}
      />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "sheet-soft fixed inset-x-0 bottom-0 z-50 flex w-full flex-col outline-none sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:max-w-sm sm:-translate-x-1/2 sm:-translate-y-1/2",
          className
        )}
        {...props}
      >
        <m.div
          {...dragProps}
          className="relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-popover text-sm text-popover-foreground shadow-2xl sm:max-h-[90dvh] sm:rounded-xl sm:ring-1 sm:ring-foreground/10"
        >
          <SheetHandle controls={controls} />
          <div className={cn("grid min-h-0 flex-1 gap-4 overflow-y-auto px-4 pb-4 pt-1 sm:pt-4", bodyClassName)}>
            {children}
          </div>
          <DialogPrimitive.Close ref={closeRef} className="hidden" tabIndex={-1} aria-hidden />
          {showCloseButton && (
            <DialogPrimitive.Close data-slot="dialog-close" asChild>
              <Button variant="ghost" className="absolute top-2 right-2" size="icon-sm">
                <XIcon />
                <span className="sr-only">Close</span>
              </Button>
            </DialogPrimitive.Close>
          )}
        </m.div>
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogContent({
  className,
  overlayClassName,
  children,
  showCloseButton = true,
  sheet = false,
  bodyClassName,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  /** For the scrim behind this dialog, e.g. `scrim-soft` (app/globals.css). */
  overlayClassName?: string
  showCloseButton?: boolean
  /** Open as the app's sheet (see SheetDialogContent). */
  sheet?: boolean
  bodyClassName?: string
}) {
  if (sheet)
    return (
      <SheetDialogContent
        className={className}
        bodyClassName={bodyClassName}
        overlayClassName={overlayClassName}
        showCloseButton={showCloseButton}
        {...props}
      >
        {children}
      </SheetDialogContent>
    )
  return (
    <DialogPortal>
      <DialogOverlay className={overlayClassName} />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close data-slot="dialog-close" asChild>
            <Button
              variant="ghost"
              className="absolute top-2 right-2"
              size="icon-sm"
            >
              <XIcon
              />
              <span className="sr-only">Close</span>
            </Button>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "font-heading text-base leading-none font-medium",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
