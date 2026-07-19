"use client"

import { Select as SelectPrimitive } from "@base-ui/react/select"
import { CheckIcon, ChevronDownIcon, ChevronUpIcon, ChevronsUpDownIcon } from "lucide-react"

import { cn } from "@/lib/utils"

function Select<Value>(props: SelectPrimitive.Root.Props<Value>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />
}

function SelectTrigger({ className, children, ...props }: SelectPrimitive.Trigger.Props) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        "flex h-11 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-base outline-none transition-colors",
        "data-[placeholder]:text-muted-foreground",
        "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        "data-[invalid]:border-destructive data-[invalid]:ring-3 data-[invalid]:ring-destructive/20",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "md:text-sm",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon className="shrink-0 text-muted-foreground">
        <ChevronsUpDownIcon className="size-4" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

function SelectValue(props: SelectPrimitive.Value.Props) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />
}

export interface SelectContentProps
  extends SelectPrimitive.Popup.Props,
    Pick<SelectPrimitive.Positioner.Props, "sideOffset" | "align" | "side"> {}

function SelectContent({ className, children, sideOffset = 6, align, side, ...props }: SelectContentProps) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner sideOffset={sideOffset} align={align} side={side} className="z-50 outline-none">
        <SelectPrimitive.ScrollUpArrow className="flex h-6 cursor-default items-center justify-center text-muted-foreground">
          <ChevronUpIcon className="size-4" />
        </SelectPrimitive.ScrollUpArrow>
        <SelectPrimitive.Popup
          data-slot="select-content"
          className={cn(
            "min-w-[var(--anchor-width)] rounded-md border bg-popover p-1 text-popover-foreground shadow-lg outline-none",
            "transition-[transform,opacity] duration-100 ease-out",
            "data-[starting-style]:scale-95 data-[starting-style]:opacity-0",
            "data-[ending-style]:scale-95 data-[ending-style]:opacity-0",
            "motion-reduce:transition-none motion-reduce:transform-none",
            className
          )}
          {...props}
        >
          {children}
        </SelectPrimitive.Popup>
        <SelectPrimitive.ScrollDownArrow className="flex h-6 cursor-default items-center justify-center text-muted-foreground">
          <ChevronDownIcon className="size-4" />
        </SelectPrimitive.ScrollDownArrow>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  )
}

function SelectItem({ className, children, ...props }: SelectPrimitive.Item.Props) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "relative flex h-9 cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-none select-none",
        "data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <span className="absolute right-2 flex size-4 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="size-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
    </SelectPrimitive.Item>
  )
}

function SelectGroup(props: SelectPrimitive.Group.Props) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />
}

function SelectGroupLabel({ className, ...props }: SelectPrimitive.GroupLabel.Props) {
  return (
    <SelectPrimitive.GroupLabel
      data-slot="select-group-label"
      className={cn("px-2 py-1.5 text-sm font-medium text-muted-foreground", className)}
      {...props}
    />
  )
}

export { Select, SelectTrigger, SelectValue, SelectContent, SelectItem, SelectGroup, SelectGroupLabel }
