"use client";
import React from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import InputField from "@/components/forms/inputfield";
import SelectField from "@/components/forms/SelectField";
import { INVESTMENT_GOALS, PREFERRED_INDUSTRIES, RISK_TOLERANCE_OPTIONS } from "@/lib/constant";
import { CountrySelectField } from "@/components/forms/CountryComponent";
import FooterLink from "@/components/forms/FooterLink";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { inngest } from "@/lib/inngest/client";
const SignUp = () => {
  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<SignUpFormData>({
    defaultValues: {
      fullName: "",
      email: "",
      password: "",
      country: "IN",
      investmentGoals: "Growth",
      riskTolerance: "Medium",
      preferredIndustry: "Technology",
    },
    mode: "onBlur",
  });
  const router = useRouter();
  const Onsubmit = async (data: SignUpFormData) => {
    console.log('[SIGNUP] Starting sign-up process with data:', data);
    try {
      console.log('[SIGNUP] Calling fetch to /api/auth/sign-up/email');
      const response = await fetch('/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: data.email,
          password: data.password,
          name: data.fullName,
        }),
      });
      
      console.log('[SIGNUP] Response received:', { ok: response.ok, status: response.status, statusText: response.statusText });
      
      if (response.ok) {
        console.log('[SIGNUP] Sign-up successful, sending Inngest event');
        // Send Inngest event for welcome email
        try {
          await inngest.send({
            name: "app/user.created",
            data: {
              email: data.email,
              name: data.fullName,
              country: data.country,
              investmentGoals: data.investmentGoals,
              riskTolerance: data.riskTolerance,
              preferredIndustry: data.preferredIndustry,
            },
          });
          console.log('[SIGNUP] Inngest event sent successfully');
        } catch (inngestError) {
          console.error('[SIGNUP] Inngest event failed:', inngestError);
          // Don't block sign-up if email fails
        }
        
        console.log('[SIGNUP] Showing success toast and redirecting');
        toast.success("Account created successfully!");
        router.push("/");
      } else {
        console.log('[SIGNUP] Sign-up failed, parsing error response');
        let errorMessage = 'Sign up failed';
        try {
          const errorData = await response.json();
          console.log('[SIGNUP] Error data from response:', errorData);
          errorMessage = errorData?.message || errorData?.error || errorMessage;
        } catch (e) {
          console.error('[SIGNUP] Failed to parse error response as JSON:', e);
          // Response might not be JSON
          errorMessage = response.statusText || errorMessage;
        }
        console.log('[SIGNUP] Throwing error with message:', errorMessage);
        throw new Error(errorMessage);
      }
    } catch (error) {
      console.error('[SIGNUP] Caught error in try-catch:', error);
      console.error('[SIGNUP] Error type:', typeof error);
      console.error('[SIGNUP] Error instanceof Error:', error instanceof Error);
      if (error && typeof error === 'object') {
        console.error('[SIGNUP] Error keys:', Object.keys(error));
        console.error('[SIGNUP] Error.message:', (error as any).message);
        console.error('[SIGNUP] Error.error:', (error as any).error);
      }
      const description = error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "Failed to create an account";
      toast.error("Something went wrong", { description });
    }
  };
  return (
    <>
      <h1 className="form-title">SignUp & Personalize</h1>
      <form onSubmit={handleSubmit(Onsubmit)} className="space-y-5">
        <InputField
          name="fullName"
          label="Full Name"
          placeholder="Enter your full name"
          register={register}
          error={errors.fullName}
          validation={{
            required: "Full name is required",
            minLength: {
              value: 2,
              message: "Full name must be at least 2 characters long",
            },
          }}
        />
        <InputField
          name="email"
          label="Email"
          placeholder="Enter your email"
          register={register}
          error={errors.email}
          validation={{
            required: "Email is required",
            pattern: {
              value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
              message: "Invalid email format",
            },
          }}
        />
        <InputField
          name="password"
          label="Password"
          placeholder="Enter your password"
          type="password"
          register={register}
          error={errors.password}
          validation={{
            required: "Password is required",
            minLength: {
              value: 8,
              message: "Password must be at least 8 characters long",
            },
          }}
        />
        <CountrySelectField
          name="country"
          label="Country"
          control={control}
          error={errors.country}
          required={true}
        />
        <SelectField
          name="investmentGoals"
          label="Investment Goals"
          placeholder="Select your investment goals"
          options={INVESTMENT_GOALS}
          control={control}
          error={errors.investmentGoals}
          required={true}
        />
        <SelectField
          name="riskTolerance"
          label="Risk Tolerance"
          placeholder="Select your risk tolerance"
          options={RISK_TOLERANCE_OPTIONS}
          control={control}
          error={errors.riskTolerance}
          required={true}
        />
        <SelectField
          name="preferredIndustry"
          label="Preferred Industry"
          placeholder="Select your preferred industry"
          options={PREFERRED_INDUSTRIES}
          control={control}
          error={errors.preferredIndustry}
          required={true}
        />
        <Button
          type="submit"
          disabled={isSubmitting}
          className="yellow-btn w-full mt-5"
        >
          {isSubmitting ? "Signing Up..." : "Sign Up"}
        </Button>
        <FooterLink text="Already have an account?" linkText="Sign-in" href="/sign-in" />
      </form>
    </>
  );
};

export default SignUp;
