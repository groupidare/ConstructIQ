import { InputHTMLAttributes, forwardRef } from 'react';
import { cn } from '@/lib/utils';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className, id, ...props }, ref) => (
    <div className="space-y-1">
      {label && <label htmlFor={id} className="label">{label}</label>}
      <input
        ref={ref}
        id={id}
        className={cn('input', error && 'border-red-500 focus:ring-red-500', className)}
        {...props}
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  ),
);
Input.displayName = 'Input';
export default Input;
