import { useState } from 'react';
import { formatDesignControlValue } from '@/lib/design-value-labels';

interface ReadableDesignInputOptions {
  rawValue: string;
  inputValue: string;
  setInputValue?: (value: string) => void;
  transformRawValue?: (value: string) => string;
}

export function useReadableDesignInput({
  rawValue,
  inputValue,
  setInputValue,
  transformRawValue,
}: ReadableDesignInputOptions) {
  const [focusedRawValue, setFocusedRawValue] = useState<string | null>(null);
  const displayValue = formatDesignControlValue(rawValue);
  const isFocused = focusedRawValue === rawValue;

  return {
    value: !isFocused && displayValue ? displayValue : inputValue,
    isFocused,
    onFocus: () => {
      setFocusedRawValue(rawValue);
      setInputValue?.(transformRawValue ? transformRawValue(rawValue) : rawValue);
    },
    onBlur: () => setFocusedRawValue(null),
  };
}
