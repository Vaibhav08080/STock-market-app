'use client';

import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import InputField from '@/components/forms/inputfield';
import FooterLink from '@/components/forms/FooterLink';
import {toast} from "sonner";
import {useRouter} from "next/navigation";

const SignIn = () => {
    const router = useRouter()
    const {
        register,
        handleSubmit,
        formState: { errors, isSubmitting },
    } = useForm<SignInFormData>({
        defaultValues: {
            email: '',
            password: '',
        },
        mode: 'onBlur',
    });

    const onSubmit = async (data: SignInFormData) => {
        console.log('[SIGNIN] Starting sign-in process');
        console.log('[SIGNIN] Email:', data.email);
        try {
            console.log('[SIGNIN] Calling fetch to /api/auth/sign-in/email');
            const response = await fetch('/api/auth/sign-in/email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: data.email,
                    password: data.password,
                }),
            });
            
            console.log('[SIGNIN] Response received:', { ok: response.ok, status: response.status, statusText: response.statusText });
            
            if (response.ok) {
                console.log('[SIGNIN] Sign-in successful, redirecting to home');
                toast.success('Signed in successfully!');
                router.push('/');
            } else {
                console.log('[SIGNIN] Sign-in failed, parsing error response');
                let errorMessage = 'Invalid email or password';
                try {
                    const errorData = await response.json();
                    console.log('[SIGNIN] Error data from response:', errorData);
                    errorMessage = errorData?.message || errorData?.error || errorMessage;
                } catch (e) {
                    console.error('[SIGNIN] Failed to parse error response as JSON:', e);
                    errorMessage = response.statusText || errorMessage;
                }
                console.log('[SIGNIN] Showing error toast with message:', errorMessage);
                toast.error('Sign in failed', { description: errorMessage });
            }
        } catch (e) {
            console.error('[SIGNIN] Caught error in try-catch:', e);
            console.error('[SIGNIN] Error type:', typeof e);
            toast.error('Sign in failed', {
                description: e instanceof Error ? e.message : 'Failed to sign in.'
            })
        }
    }

    return (
        <>
            <h1 className="form-title">Welcome back</h1>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
                <InputField
                    name="email"
                    label="Email"
                    placeholder="contact@jsmastery.com"
                    register={register}
                    error={errors.email}
                    validation={{ required: 'Email is required', pattern: /^\w+@\w+\.\w+$/ }}
                />

                <InputField
                    name="password"
                    label="Password"
                    placeholder="Enter your password"
                    type="password"
                    register={register}
                    error={errors.password}
                    validation={{ required: 'Password is required', minLength: 8 }}
                />

                <Button type="submit" disabled={isSubmitting} className="yellow-btn w-full mt-5">
                    {isSubmitting ? 'Signing In' : 'Sign In'}
                </Button>

                <FooterLink text="Don't have an account?" linkText="Create an account" href="/sign-up" />
            </form>
        </>
    );
};
export default SignIn;