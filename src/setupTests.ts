/// <reference types="@testing-library/jest-dom" />
import '@testing-library/jest-dom';

// Extend the Jest matchers
declare global {
    namespace jest {
        interface Matchers<R> {
            toBeInTheDocument(): R;
            toHaveTextContent(text: string): R;
            toHaveClass(className: string): R;
            toBeDisabled(): R;
            toBeEnabled(): R;
            toHaveValue(value: string): R;
        }
    }
}
