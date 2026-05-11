'use client';

import { useLayoutEffect } from 'react';
import { SAFE_BODY_STYLE_PROPS, parseSafeBodyStyle, type SafeBodyStyleDeclaration } from '@/lib/body-style';

const APPLIED_CLASSES_ATTR = 'ycodeAppliedBodyClasses';
const APPLIED_STYLE_PROPS_ATTR = 'ycodeAppliedBodyStyleProps';
const REMOVED_SHELL_TEXT_ATTR = 'ycodeRemovedShellTextXs';
const BOOTSTRAP_STYLE_SNAPSHOT_ATTR = 'ycodeBootstrapBodyStyleSnapshot';
type BodyStyleSnapshot = Record<string, {
  value: string;
  priority: string;
  hadValue: boolean;
}>;

function bodyClassList(classes: string): string[] {
  const classList = (classes || 'bg-white')
    .split(/\s+/)
    .map((className) => className.trim())
    .filter((className) => className.length > 0 && !/[<>"'=&]/.test(className));
  return classList.length > 0 ? classList : ['bg-white'];
}

function removePreviouslyAppliedBodyClasses() {
  const appliedClasses = document.body.dataset[APPLIED_CLASSES_ATTR]?.split(/\s+/).filter(Boolean) || [];
  if (appliedClasses.length > 0) {
    document.body.classList.remove(...appliedClasses);
  }
}

function removePreviouslyAppliedBodyStyles() {
  const appliedProps = document.body.dataset[APPLIED_STYLE_PROPS_ATTR]
    ?.split(',')
    .map((prop) => prop.trim())
    .filter((prop) => SAFE_BODY_STYLE_PROPS.has(prop)) || [];
  for (const prop of appliedProps) {
    document.body.style.removeProperty(prop);
  }
}

function applyBodyStyle(declarations: SafeBodyStyleDeclaration[]): BodyStyleSnapshot {
  const previous: BodyStyleSnapshot = {};

  for (const { prop, value, priority } of declarations) {
    const previousValue = document.body.style.getPropertyValue(prop);
    const previousPriority = document.body.style.getPropertyPriority(prop);
    previous[prop] = {
      value: previousValue,
      priority: previousPriority,
      hadValue: previousValue !== '' || previousPriority !== '',
    };
    document.body.style.setProperty(prop, value, priority);
  }

  return previous;
}

function restoreBodyStyle(snapshot: BodyStyleSnapshot) {
  for (const [prop, previous] of Object.entries(snapshot)) {
    if (previous.hadValue) {
      document.body.style.setProperty(prop, previous.value, previous.priority);
    } else {
      document.body.style.removeProperty(prop);
    }
  }
}

function readBootstrapStyleSnapshot(): BodyStyleSnapshot | null {
  const raw = document.body.dataset[BOOTSTRAP_STYLE_SNAPSHOT_ATTR];
  delete document.body.dataset[BOOTSTRAP_STYLE_SNAPSHOT_ATTR];
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as BodyStyleSnapshot;
    const snapshot: BodyStyleSnapshot = {};
    for (const [prop, previous] of Object.entries(parsed)) {
      if (!SAFE_BODY_STYLE_PROPS.has(prop)) continue;
      if (!previous || typeof previous !== 'object') continue;
      snapshot[prop] = {
        value: typeof previous.value === 'string' ? previous.value : '',
        priority: previous.priority === 'important' ? 'important' : '',
        hadValue: Boolean(previous.hadValue),
      };
    }
    return snapshot;
  } catch {
    return null;
  }
}

export default function BodyClassApplier({ classes, style }: { classes: string; style?: string }) {
  useLayoutEffect(() => {
    const classList = bodyClassList(classes);
    const styleDeclarations = parseSafeBodyStyle(style);
    const bootstrapStyleSnapshot = readBootstrapStyleSnapshot();

    removePreviouslyAppliedBodyClasses();
    removePreviouslyAppliedBodyStyles();
    const hadShellTextClass = document.body.classList.contains('text-xs')
      || document.body.dataset[REMOVED_SHELL_TEXT_ATTR] === 'true';

    // The studio shell uses text-xs for editor UI chrome. Published/previewed
    // pages must inherit their own body layer typography instead of that shell
    // utility.
    document.body.classList.remove('text-xs');
    document.body.classList.add(...classList);
    const previousBodyStyle = bootstrapStyleSnapshot || applyBodyStyle(styleDeclarations);
    if (bootstrapStyleSnapshot) {
      for (const { prop, value, priority } of styleDeclarations) {
        document.body.style.setProperty(prop, value, priority);
      }
    }

    document.body.dataset[APPLIED_CLASSES_ATTR] = classList.join(' ');
    document.body.dataset[APPLIED_STYLE_PROPS_ATTR] = styleDeclarations.map(({ prop }) => prop).join(',');
    if (hadShellTextClass) {
      document.body.dataset[REMOVED_SHELL_TEXT_ATTR] = 'true';
    }

    return () => {
      removePreviouslyAppliedBodyClasses();
      restoreBodyStyle(previousBodyStyle);
      delete document.body.dataset[APPLIED_CLASSES_ATTR];
      delete document.body.dataset[APPLIED_STYLE_PROPS_ATTR];
      if (document.body.dataset[REMOVED_SHELL_TEXT_ATTR] === 'true') {
        document.body.classList.add('text-xs');
        delete document.body.dataset[REMOVED_SHELL_TEXT_ATTR];
      }
    };
  }, [classes, style]);

  return null;
}
