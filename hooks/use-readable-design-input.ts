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
  const [isFocused, setIsFocused] = useState(false);
  const displayValue = formatDesignControlValue(rawValue);

  return {
    value: !isFocused && displayValue ? displayValue : inputValue,
    isFocused,
    onFocus: () => {
      setIsFocused(true);
      setInputValue?.(transformRawValue ? transformRawValue(rawValue) : rawValue);
    },
    onBlur: () => setIsFocused(false),
  };
}
