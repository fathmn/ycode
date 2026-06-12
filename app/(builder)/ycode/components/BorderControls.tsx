'use client';

import React, { useState, useCallback, memo } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import Icon from '@/components/ui/icon';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useDesignSync } from '@/hooks/use-design-sync';
import { useControlledInputs } from '@/hooks/use-controlled-input';
import { useReadableDesignInput } from '@/hooks/use-readable-design-input';
import { useModeToggle } from '@/hooks/use-mode-toggle';
import { useEditorStore } from '@/stores/useEditorStore';
import { useColorVariablesStore } from '@/stores/useColorVariablesStore';
import { extractMeasurementValue } from '@/lib/measurement-utils';
import { formatDesignValueHint } from '@/lib/design-value-labels';
import { cn, removeSpaces } from '@/lib/utils';
import ColorPropertyField from './ColorPropertyField';
import type { Collection, CollectionField, Layer } from '@/types';
import type { FieldGroup } from '@/lib/collection-field-utils';

interface BorderControlsProps {
  layer: Layer | null;
  onLayerUpdate: (layerId: string, updates: Partial<Layer>) => void;
  activeTextStyleKey?: string | null;
  fieldGroups?: FieldGroup[];
  allFields?: Record<string, CollectionField[]>;
  collections?: Collection[];
}

function hexToRgba(value: string): string {
  const parts = value.split('/');
  if (parts.length < 2) return value;
  const hex = parts[0];
  const opacity = parseInt(parts[1]) / 100;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${opacity})`;
}

function parseBorderColorToCss(color: string, colorVariables?: import('@/types').ColorVariable[]): string {
  if (!color) return '#000000';
  const varMatch = color.match(/^color:var\(--(.+)\)$/);
  if (varMatch && colorVariables) {
    const variable = colorVariables.find((v) => v.id === varMatch[1]);
    return variable ? hexToRgba(variable.value) : '#000000';
  }
  const match = color.match(/^(#[0-9a-fA-F]{6})\/(\d+)$/);
  if (match) {
    const hex = match[1];
    const a = parseInt(match[2]) / 100;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${a})`;
  }
  return color;
}

const BorderControls = memo(function BorderControls({ layer, onLayerUpdate, activeTextStyleKey, fieldGroups, allFields, collections }: BorderControlsProps) {
  const activeBreakpoint = useEditorStore((s) => s.activeBreakpoint);
  const activeUIState = useEditorStore((s) => s.activeUIState);
  const colorVariables = useColorVariablesStore((s) => s.colorVariables);
  const { updateDesignProperty, updateDesignProperties, debouncedUpdateDesignProperty, getDesignProperty } = useDesignSync({
    layer,
    onLayerUpdate,
    activeBreakpoint,
    activeUIState,
    activeTextStyleKey,
  });

  // Get current values from layer (with inheritance)
  const borderRadius = getDesignProperty('borders', 'borderRadius') || '';
  const borderTopLeftRadius = getDesignProperty('borders', 'borderTopLeftRadius') || '';
  const borderTopRightRadius = getDesignProperty('borders', 'borderTopRightRadius') || '';
  const borderBottomRightRadius = getDesignProperty('borders', 'borderBottomRightRadius') || '';
  const borderBottomLeftRadius = getDesignProperty('borders', 'borderBottomLeftRadius') || '';
  const borderWidth = getDesignProperty('borders', 'borderWidth') || '';
  const borderTopWidth = getDesignProperty('borders', 'borderTopWidth') || '';
  const borderRightWidth = getDesignProperty('borders', 'borderRightWidth') || '';
  const borderBottomWidth = getDesignProperty('borders', 'borderBottomWidth') || '';
  const borderLeftWidth = getDesignProperty('borders', 'borderLeftWidth') || '';
  const borderStyle = getDesignProperty('borders', 'borderStyle') || 'solid';
  const borderColor = getDesignProperty('borders', 'borderColor') || '';
  // Check for border existence from both class-based values AND design object
  // This ensures backwards compatibility with layers that have design properties but missing classes
  const designBorders = layer?.design?.borders;
  const hasBorder = !!(
    borderWidth || borderTopWidth || borderRightWidth || borderBottomWidth || borderLeftWidth ||
    designBorders?.borderWidth || designBorders?.borderTopWidth || designBorders?.borderRightWidth ||
    designBorders?.borderBottomWidth || designBorders?.borderLeftWidth
  );

  const divideX = getDesignProperty('borders', 'divideX') || '';
  const divideY = getDesignProperty('borders', 'divideY') || '';
  const divideStyle = getDesignProperty('borders', 'divideStyle') || 'solid';
  const divideColor = getDesignProperty('borders', 'divideColor') || '';
  const hasDivider = !!(divideX || divideY || divideColor || designBorders?.divideX || designBorders?.divideY || designBorders?.divideColor);

  const outlineWidth = getDesignProperty('borders', 'outlineWidth') || '';
  const outlineColor = getDesignProperty('borders', 'outlineColor') || '';
  const outlineOffset = getDesignProperty('borders', 'outlineOffset') || '';
  const hasOutline = !!(outlineWidth || outlineColor || designBorders?.outlineWidth || designBorders?.outlineColor);

  // Local controlled inputs (prevents repopulation bug)
  const inputs = useControlledInputs({
    borderRadius,
    borderTopLeftRadius,
    borderTopRightRadius,
    borderBottomRightRadius,
    borderBottomLeftRadius,
    borderWidth,
    borderTopWidth,
    borderRightWidth,
    borderBottomWidth,
    borderLeftWidth,
    divideX,
    divideY,
    outlineWidth,
    outlineOffset,
  }, extractMeasurementValue);

  const [borderRadiusInput, setBorderRadiusInput] = inputs.borderRadius;
  const [borderTopLeftRadiusInput, setBorderTopLeftRadiusInput] = inputs.borderTopLeftRadius;
  const [borderTopRightRadiusInput, setBorderTopRightRadiusInput] = inputs.borderTopRightRadius;
  const [borderBottomRightRadiusInput, setBorderBottomRightRadiusInput] = inputs.borderBottomRightRadius;
  const [borderBottomLeftRadiusInput, setBorderBottomLeftRadiusInput] = inputs.borderBottomLeftRadius;
  const [borderWidthInput, setBorderWidthInput] = inputs.borderWidth;
  const [borderTopWidthInput, setBorderTopWidthInput] = inputs.borderTopWidth;
  const [borderRightWidthInput, setBorderRightWidthInput] = inputs.borderRightWidth;
  const [borderBottomWidthInput, setBorderBottomWidthInput] = inputs.borderBottomWidth;
  const [borderLeftWidthInput, setBorderLeftWidthInput] = inputs.borderLeftWidth;
  const [divideXInput, setDivideXInput] = inputs.divideX;
  const [divideYInput, setDivideYInput] = inputs.divideY;
  const [outlineWidthInput, setOutlineWidthInput] = inputs.outlineWidth;
  const [outlineOffsetInput, setOutlineOffsetInput] = inputs.outlineOffset;
  const borderRadiusControl = useReadableDesignInput({
    rawValue: borderRadius,
    inputValue: borderRadiusInput,
    setInputValue: setBorderRadiusInput,
    transformRawValue: extractMeasurementValue,
  });
  const borderTopLeftRadiusControl = useReadableDesignInput({
    rawValue: borderTopLeftRadius,
    inputValue: borderTopLeftRadiusInput,
    setInputValue: setBorderTopLeftRadiusInput,
    transformRawValue: extractMeasurementValue,
  });
  const borderTopRightRadiusControl = useReadableDesignInput({
    rawValue: borderTopRightRadius,
    inputValue: borderTopRightRadiusInput,
    setInputValue: setBorderTopRightRadiusInput,
    transformRawValue: extractMeasurementValue,
  });
  const borderBottomLeftRadiusControl = useReadableDesignInput({
    rawValue: borderBottomLeftRadius,
    inputValue: borderBottomLeftRadiusInput,
    setInputValue: setBorderBottomLeftRadiusInput,
    transformRawValue: extractMeasurementValue,
  });
  const borderBottomRightRadiusControl = useReadableDesignInput({
    rawValue: borderBottomRightRadius,
    inputValue: borderBottomRightRadiusInput,
    setInputValue: setBorderBottomRightRadiusInput,
    transformRawValue: extractMeasurementValue,
  });
  const borderWidthControl = useReadableDesignInput({
    rawValue: borderWidth,
    inputValue: borderWidthInput,
    setInputValue: setBorderWidthInput,
    transformRawValue: extractMeasurementValue,
  });
  const borderTopWidthControl = useReadableDesignInput({
    rawValue: borderTopWidth,
    inputValue: borderTopWidthInput,
    setInputValue: setBorderTopWidthInput,
    transformRawValue: extractMeasurementValue,
  });
  const borderRightWidthControl = useReadableDesignInput({
    rawValue: borderRightWidth,
    inputValue: borderRightWidthInput,
    setInputValue: setBorderRightWidthInput,
    transformRawValue: extractMeasurementValue,
  });
  const borderBottomWidthControl = useReadableDesignInput({
    rawValue: borderBottomWidth,
    inputValue: borderBottomWidthInput,
    setInputValue: setBorderBottomWidthInput,
    transformRawValue: extractMeasurementValue,
  });
  const borderLeftWidthControl = useReadableDesignInput({
    rawValue: borderLeftWidth,
    inputValue: borderLeftWidthInput,
    setInputValue: setBorderLeftWidthInput,
    transformRawValue: extractMeasurementValue,
  });
  const divideYControl = useReadableDesignInput({
    rawValue: divideY,
    inputValue: divideYInput,
    setInputValue: setDivideYInput,
    transformRawValue: extractMeasurementValue,
  });
  const divideXControl = useReadableDesignInput({
    rawValue: divideX,
    inputValue: divideXInput,
    setInputValue: setDivideXInput,
    transformRawValue: extractMeasurementValue,
  });
  const outlineWidthControl = useReadableDesignInput({
    rawValue: outlineWidth,
    inputValue: outlineWidthInput,
    setInputValue: setOutlineWidthInput,
    transformRawValue: extractMeasurementValue,
  });
  const outlineOffsetControl = useReadableDesignInput({
    rawValue: outlineOffset,
    inputValue: outlineOffsetInput,
    setInputValue: setOutlineOffsetInput,
    transformRawValue: extractMeasurementValue,
  });

  // Use mode toggle hooks for radius and width
  const radiusModeToggle = useModeToggle({
    category: 'borders',
    unifiedProperty: 'borderRadius',
    individualProperties: ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius'],
    modeProperty: 'borderRadiusMode',
    updateDesignProperty,
    updateDesignProperties,
    getCurrentValue: (prop: string) => getDesignProperty('borders', prop) || '',
    getStoredMode: () => (layer?.design?.borders as Record<string, unknown>)?.borderRadiusMode as 'all' | 'individual' | null,
  });

  const widthModeToggle = useModeToggle({
    category: 'borders',
    unifiedProperty: 'borderWidth',
    individualProperties: ['borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth'],
    modeProperty: 'borderWidthMode',
    updateDesignProperty,
    updateDesignProperties,
    getCurrentValue: (prop: string) => getDesignProperty('borders', prop) || '',
    getStoredMode: () => (layer?.design?.borders as Record<string, unknown>)?.borderWidthMode as 'all' | 'individual' | null,
  });

  // Handle radius changes (debounced for text input)
  const handleRadiusChange = (value: string) => {
    setBorderRadiusInput(value);
    const sanitized = removeSpaces(value);
    debouncedUpdateDesignProperty('borders', 'borderRadius', sanitized || null);
  };

  const handleTopLeftRadiusChange = (value: string) => {
    setBorderTopLeftRadiusInput(value);
    const sanitized = removeSpaces(value);
    debouncedUpdateDesignProperty('borders', 'borderTopLeftRadius', sanitized || null);
  };

  const handleTopRightRadiusChange = (value: string) => {
    setBorderTopRightRadiusInput(value);
    const sanitized = removeSpaces(value);
    debouncedUpdateDesignProperty('borders', 'borderTopRightRadius', sanitized || null);
  };

  const handleBottomRightRadiusChange = (value: string) => {
    setBorderBottomRightRadiusInput(value);
    const sanitized = removeSpaces(value);
    debouncedUpdateDesignProperty('borders', 'borderBottomRightRadius', sanitized || null);
  };

  const handleBottomLeftRadiusChange = (value: string) => {
    setBorderBottomLeftRadiusInput(value);
    const sanitized = removeSpaces(value);
    debouncedUpdateDesignProperty('borders', 'borderBottomLeftRadius', sanitized || null);
  };

  // Handle border width changes (debounced for text input)
  const handleBorderWidthChange = (value: string) => {
    setBorderWidthInput(value);
    const sanitized = removeSpaces(value);
    debouncedUpdateDesignProperty('borders', 'borderWidth', sanitized || null);
  };

  const handleTopWidthChange = (value: string) => {
    setBorderTopWidthInput(value);
    const sanitized = removeSpaces(value);
    debouncedUpdateDesignProperty('borders', 'borderTopWidth', sanitized || null);
  };

  const handleRightWidthChange = (value: string) => {
    setBorderRightWidthInput(value);
    const sanitized = removeSpaces(value);
    debouncedUpdateDesignProperty('borders', 'borderRightWidth', sanitized || null);
  };

  const handleBottomWidthChange = (value: string) => {
    setBorderBottomWidthInput(value);
    const sanitized = removeSpaces(value);
    debouncedUpdateDesignProperty('borders', 'borderBottomWidth', sanitized || null);
  };

  const handleLeftWidthChange = (value: string) => {
    setBorderLeftWidthInput(value);
    const sanitized = removeSpaces(value);
    debouncedUpdateDesignProperty('borders', 'borderLeftWidth', sanitized || null);
  };

  // Handle border style change (immediate - dropdown selection)
  const handleBorderStyleChange = (value: string) => {
    updateDesignProperty('borders', 'borderStyle', value);
  };

  // Debounced handler for keyboard-typed hex values
  const handleBorderColorChange = (value: string) => {
    const sanitized = removeSpaces(value);
    debouncedUpdateDesignProperty('borders', 'borderColor', sanitized || null);
  };

  // Immediate handler for programmatic changes
  const handleBorderColorImmediate = (value: string) => {
    const sanitized = removeSpaces(value);
    updateDesignProperty('borders', 'borderColor', sanitized || null);
  };

  // Add border
  const handleAddBorder = () => {
    updateDesignProperties([
      { category: 'borders', property: 'borderWidth', value: '1px' },
      { category: 'borders', property: 'borderStyle', value: 'solid' },
      { category: 'borders', property: 'borderColor', value: '#000000' },
    ]);
  };

  // Remove border
  const handleRemoveBorder = () => {
    updateDesignProperties([
      { category: 'borders', property: 'borderWidth', value: null },
      { category: 'borders', property: 'borderTopWidth', value: null },
      { category: 'borders', property: 'borderRightWidth', value: null },
      { category: 'borders', property: 'borderBottomWidth', value: null },
      { category: 'borders', property: 'borderLeftWidth', value: null },
      { category: 'borders', property: 'borderStyle', value: null },
      { category: 'borders', property: 'borderColor', value: null },
    ]);
  };

  const handleDivideXChange = (value: string) => {
    setDivideXInput(value);
    const sanitized = removeSpaces(value);
    debouncedUpdateDesignProperty('borders', 'divideX', sanitized || null);
  };

  const handleDivideYChange = (value: string) => {
    setDivideYInput(value);
    const sanitized = removeSpaces(value);
    debouncedUpdateDesignProperty('borders', 'divideY', sanitized || null);
  };

  const handleDivideStyleChange = (value: string) => {
    updateDesignProperty('borders', 'divideStyle', value);
  };

  const handleDivideColorChange = (value: string) => {
    const sanitized = removeSpaces(value);
    debouncedUpdateDesignProperty('borders', 'divideColor', sanitized || null);
  };

  const handleDivideColorImmediate = (value: string) => {
    const sanitized = removeSpaces(value);
    updateDesignProperty('borders', 'divideColor', sanitized || null);
  };

  const handleAddDivider = () => {
    updateDesignProperties([
      { category: 'borders', property: 'divideY', value: '[1px]' },
      { category: 'borders', property: 'divideStyle', value: 'solid' },
      { category: 'borders', property: 'divideColor', value: '#000000' },
    ]);
  };

  const handleRemoveDivider = () => {
    updateDesignProperties([
      { category: 'borders', property: 'divideX', value: null },
      { category: 'borders', property: 'divideY', value: null },
      { category: 'borders', property: 'divideStyle', value: null },
      { category: 'borders', property: 'divideColor', value: null },
    ]);
  };

  const handleOutlineWidthChange = (value: string) => {
    setOutlineWidthInput(value);
    const sanitized = removeSpaces(value);
    debouncedUpdateDesignProperty('borders', 'outlineWidth', sanitized || null);
  };

  const handleOutlineColorChange = (value: string) => {
    const sanitized = removeSpaces(value);
    debouncedUpdateDesignProperty('borders', 'outlineColor', sanitized || null);
  };

  const handleOutlineColorImmediate = (value: string) => {
    const sanitized = removeSpaces(value);
    updateDesignProperty('borders', 'outlineColor', sanitized || null);
  };

  const handleOutlineOffsetChange = (value: string) => {
    setOutlineOffsetInput(value);
    const sanitized = removeSpaces(value);
    debouncedUpdateDesignProperty('borders', 'outlineOffset', sanitized || null);
  };

  const handleAddOutline = () => {
    updateDesignProperties([
      { category: 'borders', property: 'outlineWidth', value: '1px' },
      { category: 'borders', property: 'outlineColor', value: '#000000' },
    ]);
  };

  const handleRemoveOutline = () => {
    updateDesignProperties([
      { category: 'borders', property: 'outlineWidth', value: null },
      { category: 'borders', property: 'outlineColor', value: null },
      { category: 'borders', property: 'outlineOffset', value: null },
    ]);
  };

  return (
    <div className="py-5">
      <header className="py-4 -mt-4 flex items-center justify-between">
        <Label>Borders</Label>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="xs">
              <Icon name="plus" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={handleAddDivider}
              disabled={hasDivider}
            >
              Dividers
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={handleAddOutline}
              disabled={hasOutline}
            >
              Outline
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <div className="flex flex-col gap-2">

        <div className="grid grid-cols-3 items-start">
          <Label variant="muted" className="h-8">Radius</Label>
          <div className="col-span-2 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Input
                stepper
                min="0"
                step="1"
                className="flex-1"
                disabled={radiusModeToggle.mode === 'individual'}
                value={borderRadiusControl.value}
                title={formatDesignValueHint(borderRadius) || borderRadius || undefined}
                onFocus={borderRadiusControl.onFocus}
                onBlur={borderRadiusControl.onBlur}
                onChange={(e) => handleRadiusChange(e.target.value)}
                placeholder="0"
              />
              <Button
                variant={radiusModeToggle.mode === 'individual' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={radiusModeToggle.handleToggle}
              >
                <Icon name="individualBorders" />
              </Button>
            </div>
            {radiusModeToggle.mode === 'individual' && (
              <div className="grid grid-cols-2 gap-2">
                <InputGroup>
                  <InputGroupAddon>
                    <Icon name="borderTopLeft" className="size-3" />
                  </InputGroupAddon>
                  <InputGroupInput
                    stepper
                    min="0"
                    step="1"
                    value={borderTopLeftRadiusControl.value}
                    title={formatDesignValueHint(borderTopLeftRadius) || borderTopLeftRadius || undefined}
                    onFocus={borderTopLeftRadiusControl.onFocus}
                    onBlur={borderTopLeftRadiusControl.onBlur}
                    onChange={(e) => handleTopLeftRadiusChange(e.target.value)}
                    placeholder="0"
                  />
                </InputGroup>
                <InputGroup>
                  <InputGroupAddon>
                    <Icon name="borderTopLeft" className="size-3 rotate-90" />
                  </InputGroupAddon>
                  <InputGroupInput
                    stepper
                    min="0"
                    step="1"
                    value={borderTopRightRadiusControl.value}
                    title={formatDesignValueHint(borderTopRightRadius) || borderTopRightRadius || undefined}
                    onFocus={borderTopRightRadiusControl.onFocus}
                    onBlur={borderTopRightRadiusControl.onBlur}
                    onChange={(e) => handleTopRightRadiusChange(e.target.value)}
                    placeholder="0"
                  />
                </InputGroup>
                <InputGroup>
                  <InputGroupAddon>
                    <Icon name="borderTopLeft" className="size-3 rotate-270" />
                  </InputGroupAddon>
                  <InputGroupInput
                    stepper
                    min="0"
                    step="1"
                    value={borderBottomLeftRadiusControl.value}
                    title={formatDesignValueHint(borderBottomLeftRadius) || borderBottomLeftRadius || undefined}
                    onFocus={borderBottomLeftRadiusControl.onFocus}
                    onBlur={borderBottomLeftRadiusControl.onBlur}
                    onChange={(e) => handleBottomLeftRadiusChange(e.target.value)}
                    placeholder="0"
                  />
                </InputGroup>
                <InputGroup>
                  <InputGroupAddon>
                    <Icon name="borderTopLeft" className="size-3 rotate-180" />
                  </InputGroupAddon>
                  <InputGroupInput
                    stepper
                    min="0"
                    step="1"
                    value={borderBottomRightRadiusControl.value}
                    title={formatDesignValueHint(borderBottomRightRadius) || borderBottomRightRadius || undefined}
                    onFocus={borderBottomRightRadiusControl.onFocus}
                    onBlur={borderBottomRightRadiusControl.onBlur}
                    onChange={(e) => handleBottomRightRadiusChange(e.target.value)}
                    placeholder="0"
                  />
                </InputGroup>
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-3 items-start">
          <Label variant="muted" className="h-8">Border</Label>
          <div className="col-span-2">
            <Popover>
              <PopoverTrigger asChild>
                {!hasBorder ? (
                  <Button
                    variant="input"
                    size="sm"
                    className="justify-start w-full"
                    onClick={handleAddBorder}
                  >
                      <div className="size-5 rounded-[6px] shrink-0 -ml-1 relative overflow-hidden outline outline-current/10 outline-offset-[-1px]">
                        <div className="absolute inset-0 opacity-15 bg-checkerboard bg-background z-10" />
                      </div>
                      <span className="dark:opacity-50">Add...</span>
                  </Button>
                ) : (
                  <Button
                    variant="input"
                    size="sm"
                    className="justify-start w-full"
                  >
                      <div className="flex items-center gap-2">
                        <div className="size-5 rounded-[6px] shrink-0 -ml-1 relative overflow-hidden outline dark:outline-white/10 outline-offset-[-1px]">
                          <div className="absolute inset-0 z-20" style={{ background: parseBorderColorToCss(borderColor, colorVariables) }} />
                          <div className="absolute inset-0 opacity-15 bg-checkerboard bg-background z-10" />
                        </div>
                        <Label variant="muted" className="capitalize">{borderStyle || 'Solid'}</Label>
                      </div>
                      <span
                        role="button"
                        tabIndex={0}
                        className="ml-auto -mr-0.5 p-0.5 rounded-sm opacity-70 hover:opacity-100 transition-opacity cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveBorder();
                        }}
                      >
                        <Icon name="x" className="size-2.5" />
                      </span>
                  </Button>
                )}
              </PopoverTrigger>

              <PopoverContent className="w-64 mr-4">
                <div className="flex flex-col gap-2">
                  <div className="grid grid-cols-3 items-start">
                    <Label variant="muted" className="h-8">Width</Label>
                    <div className="col-span-2 flex flex-col gap-2">
                      <div className="flex items-center gap-2">
                        <Input
                          stepper
                          min="0"
                          step="1"
                          className="flex-1"
                          disabled={widthModeToggle.mode === 'individual'}
                          value={borderWidthControl.value}
                          title={formatDesignValueHint(borderWidth) || borderWidth || undefined}
                          onFocus={borderWidthControl.onFocus}
                          onBlur={borderWidthControl.onBlur}
                          onChange={(e) => handleBorderWidthChange(e.target.value)}
                          placeholder="1"
                        />
                        <Button
                          variant={widthModeToggle.mode === 'individual' ? 'secondary' : 'ghost'}
                          size="sm"
                          onClick={widthModeToggle.handleToggle}
                        >
                          <Icon name="individualBorders" />
                        </Button>
                      </div>
                      {widthModeToggle.mode === 'individual' && (
                          <div className="grid grid-cols-2 gap-2">
                            <div className="flex flex-col items-start gap-1">
                              <Input
                                stepper
                                min="0"
                                step="1"
                                value={borderTopWidthControl.value}
                                title={formatDesignValueHint(borderTopWidth) || borderTopWidth || undefined}
                                onFocus={borderTopWidthControl.onFocus}
                                onBlur={borderTopWidthControl.onBlur}
                                onChange={(e) => handleTopWidthChange(e.target.value)}
                                placeholder="1"
                              />
                              <Label className="text-[8px]!" variant="muted">Top</Label>
                            </div>
                            <div className="flex flex-col items-center gap-1">
                              <Input
                                stepper
                                min="0"
                                step="1"
                                value={borderRightWidthControl.value}
                                title={formatDesignValueHint(borderRightWidth) || borderRightWidth || undefined}
                                onFocus={borderRightWidthControl.onFocus}
                                onBlur={borderRightWidthControl.onBlur}
                                onChange={(e) => handleRightWidthChange(e.target.value)}
                                placeholder="1"
                              />
                              <Label className="text-[8px]!" variant="muted">Right</Label>
                            </div>
                            <div className="flex flex-col items-center gap-1">
                              <Input
                                stepper
                                min="0"
                                step="1"
                                value={borderBottomWidthControl.value}
                                title={formatDesignValueHint(borderBottomWidth) || borderBottomWidth || undefined}
                                onFocus={borderBottomWidthControl.onFocus}
                                onBlur={borderBottomWidthControl.onBlur}
                                onChange={(e) => handleBottomWidthChange(e.target.value)}
                                placeholder="1"
                              />
                              <Label className="text-[8px]!" variant="muted">Bottom</Label>
                            </div>
                            <div className="flex flex-col items-center gap-1">
                              <Input
                                stepper
                                min="0"
                                step="1"
                                value={borderLeftWidthControl.value}
                                title={formatDesignValueHint(borderLeftWidth) || borderLeftWidth || undefined}
                                onFocus={borderLeftWidthControl.onFocus}
                                onBlur={borderLeftWidthControl.onBlur}
                                onChange={(e) => handleLeftWidthChange(e.target.value)}
                                placeholder="1"
                              />
                              <Label className="text-[8px]!" variant="muted">Left</Label>
                            </div>
                          </div>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-3">
                    <Label variant="muted">Style</Label>
                    <div className="col-span-2 *:w-full">
                      <Select value={borderStyle} onValueChange={handleBorderStyleChange}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectItem value="solid">Solid</SelectItem>
                            <SelectItem value="dashed">Dashed</SelectItem>
                            <SelectItem value="dotted">Dotted</SelectItem>
                            <SelectItem value="double">Double</SelectItem>
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-3">
                    <Label variant="muted">Color</Label>
                    <div className="col-span-2 *:w-full">
                      <ColorPropertyField
                        solidOnly
                        value={borderColor || '#000000'}
                        onChange={handleBorderColorChange}
                        onImmediateChange={handleBorderColorImmediate}
                        layer={layer}
                        onLayerUpdate={onLayerUpdate}
                        designProperty="borderColor"
                        fieldGroups={fieldGroups}
                        allFields={allFields}
                        collections={collections}
                      />
                    </div>
                  </div>

                </div>

              </PopoverContent>
            </Popover>
          </div>
        </div>

        {hasDivider && (
          <div className="grid grid-cols-3 items-start">
            <Label variant="muted" className="h-8">Dividers</Label>
            <div className="col-span-2 flex items-center gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="input"
                    size="sm"
                    className="justify-start flex-1"
                  >
                    <Label variant="muted" className="capitalize cursor-pointer">{divideStyle || 'Solid'}</Label>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-64 mr-4">
                  <div className="flex flex-col gap-2">
                    <div className="grid grid-cols-3 items-start">
                      <Label variant="muted" className="h-8">Width</Label>
                      <div className="col-span-2 grid grid-cols-2 gap-2">
                        <InputGroup>
                          <InputGroupAddon>
                            <div className="flex">
                              <Tooltip>
                                <TooltipTrigger>
                                  <Icon name="maxSize" className="size-3 rotate-90" />
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>Vertical</p>
                                </TooltipContent>
                              </Tooltip>
                            </div>
                          </InputGroupAddon>
                          <InputGroupInput
                            stepper
                            min="0"
                            step="1"
                            value={divideYControl.value}
                            title={formatDesignValueHint(divideY) || divideY || undefined}
                            onFocus={divideYControl.onFocus}
                            onBlur={divideYControl.onBlur}
                            onChange={(e) => handleDivideYChange(e.target.value)}
                            placeholder="0"
                          />
                        </InputGroup>
                        <InputGroup>
                          <InputGroupAddon>
                            <div className="flex">
                              <Tooltip>
                                <TooltipTrigger>
                                  <Icon name="maxSize" className="size-3" />
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>Horizontal</p>
                                </TooltipContent>
                              </Tooltip>
                            </div>
                          </InputGroupAddon>
                          <InputGroupInput
                            stepper
                            min="0"
                            step="1"
                            value={divideXControl.value}
                            title={formatDesignValueHint(divideX) || divideX || undefined}
                            onFocus={divideXControl.onFocus}
                            onBlur={divideXControl.onBlur}
                            onChange={(e) => handleDivideXChange(e.target.value)}
                            placeholder="0"
                          />
                        </InputGroup>
                      </div>
                    </div>
                    <div className="grid grid-cols-3">
                      <Label variant="muted">Style</Label>
                      <div className="col-span-2 *:w-full">
                        <Select value={divideStyle} onValueChange={handleDivideStyleChange}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectItem value="solid">Solid</SelectItem>
                              <SelectItem value="dashed">Dashed</SelectItem>
                              <SelectItem value="dotted">Dotted</SelectItem>
                              <SelectItem value="double">Double</SelectItem>
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="grid grid-cols-3">
                      <Label variant="muted">Color</Label>
                      <div className="col-span-2 *:w-full">
                        <ColorPropertyField
                          solidOnly
                          value={divideColor || '#000000'}
                          onChange={handleDivideColorChange}
                          onImmediateChange={handleDivideColorImmediate}
                          layer={layer}
                          onLayerUpdate={onLayerUpdate}
                          designProperty="divideColor"
                          fieldGroups={fieldGroups}
                          allFields={allFields}
                          collections={collections}
                        />
                      </div>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
              <span
                role="button"
                tabIndex={0}
                className="p-0.5 rounded-sm opacity-70 hover:opacity-100 transition-opacity cursor-pointer"
                onClick={handleRemoveDivider}
              >
                <Icon name="x" className="size-2.5" />
              </span>
            </div>
          </div>
        )}

        {hasOutline && (
          <div className="grid grid-cols-3 items-start">
            <Label variant="muted" className="h-8">Outline</Label>
            <div className="col-span-2 flex items-center gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="input"
                    size="sm"
                    className="justify-start flex-1"
                  >
                    <div className="flex items-center gap-2">
                      <div className="size-5 rounded-[6px] shrink-0 -ml-1 relative overflow-hidden outline dark:outline-white/10 outline-offset-[-1px]">
                        <div className="absolute inset-0 z-20" style={{ background: parseBorderColorToCss(outlineColor, colorVariables) }} />
                        <div className="absolute inset-0 opacity-15 bg-checkerboard bg-background z-10" />
                      </div>
                      <Label variant="muted" className="cursor-pointer">{outlineWidth || '1px'}</Label>
                    </div>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-64 mr-4">
                  <div className="flex flex-col gap-2">
                    <div className="grid grid-cols-3">
                      <Label variant="muted">Width</Label>
                      <div className="col-span-2">
                        <Input
                          stepper
                          min="0"
                          step="1"
                          value={outlineWidthControl.value}
                          title={formatDesignValueHint(outlineWidth) || outlineWidth || undefined}
                          onFocus={outlineWidthControl.onFocus}
                          onBlur={outlineWidthControl.onBlur}
                          onChange={(e) => handleOutlineWidthChange(e.target.value)}
                          placeholder="1"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-3">
                      <Label variant="muted">Color</Label>
                      <div className="col-span-2 *:w-full">
                        <ColorPropertyField
                          solidOnly
                          value={outlineColor || '#000000'}
                          onChange={handleOutlineColorChange}
                          onImmediateChange={handleOutlineColorImmediate}
                          layer={layer}
                          onLayerUpdate={onLayerUpdate}
                          designProperty="outlineColor"
                          fieldGroups={fieldGroups}
                          allFields={allFields}
                          collections={collections}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-3">
                      <Label variant="muted">Offset</Label>
                      <div className="col-span-2">
                        <Input
                          stepper
                          step="1"
                          value={outlineOffsetControl.value}
                          title={formatDesignValueHint(outlineOffset) || outlineOffset || undefined}
                          onFocus={outlineOffsetControl.onFocus}
                          onBlur={outlineOffsetControl.onBlur}
                          onChange={(e) => handleOutlineOffsetChange(e.target.value)}
                          placeholder="0"
                        />
                      </div>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
              <span
                role="button"
                tabIndex={0}
                className="p-0.5 rounded-sm opacity-70 hover:opacity-100 transition-opacity cursor-pointer"
                onClick={handleRemoveOutline}
              >
                <Icon name="x" className="size-2.5" />
              </span>
            </div>
          </div>
        )}

      </div>

    </div>
  );
});
export default BorderControls;
