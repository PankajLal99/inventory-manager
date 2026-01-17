import { InputHTMLAttributes, forwardRef } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className = '', onBlur, onChange, ...props }, ref) => {
  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    // Trim value on blur for text-like inputs
    const inputType = props.type || 'text';
    const shouldTrim = ['text', 'search', 'email', 'tel', 'url', 'password'].includes(inputType);
    
    if (shouldTrim && e.target.value !== e.target.value.trim()) {
      e.target.value = e.target.value.trim();
      // Trigger onChange with trimmed value
      if (onChange) {
        const syntheticEvent = {
          ...e,
          target: { ...e.target, value: e.target.value.trim() },
          currentTarget: { ...e.currentTarget, value: e.target.value.trim() },
        } as React.ChangeEvent<HTMLInputElement>;
        onChange(syntheticEvent);
      }
    }
    
    // Call original onBlur if provided
    if (onBlur) {
      onBlur(e);
    }
  };

  return (
    <div>
      {label && (
        <label htmlFor={props.id} className="block text-sm font-medium text-gray-700 mb-1">
          {label}
        </label>
      )}
      <input
        ref={ref}
        className={`block w-full px-3 py-2.5 border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors ${
          error ? 'border-red-300 focus:border-red-500 focus:ring-red-500' : 'border-gray-300'
        } ${className}`}
        {...props}
        onChange={onChange}
        onBlur={handleBlur}
      />
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  );
}
);

Input.displayName = 'Input';

export default Input;

