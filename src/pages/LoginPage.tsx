import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useNavigate, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authApi } from "@/api";
import { useAuthStore } from "@/hooks";
import { loginFormSchema, type LoginFormData } from "@/schemas";

interface LocationState {
  from?: string;
}

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const setToken = useAuthStore((s) => s.setToken);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginFormSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = async (data: LoginFormData) => {
    setSubmitError(null);
    setIsSubmitting(true);
    try {
      const { token } = await authApi.login(data);
      setToken(token);
      const state = location.state as LocationState | null;
      navigate(state?.from || "/", { replace: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Login failed";
      setSubmitError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="mx-auto mt-12 w-full max-w-sm">
      <h1 className="mb-6 text-3xl font-bold tracking-tight">Sign in</h1>

      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <div className="flex flex-col">
          <label
            htmlFor="login-email"
            className="mb-1 text-xs font-medium text-muted-foreground"
          >
            Email
          </label>
          <Input
            id="login-email"
            type="email"
            autoComplete="username"
            {...register("email")}
            aria-invalid={!!errors.email}
          />
          {errors.email && (
            <span className="mt-1 text-xs text-destructive">{errors.email.message}</span>
          )}
        </div>

        <div className="flex flex-col">
          <label
            htmlFor="login-password"
            className="mb-1 text-xs font-medium text-muted-foreground"
          >
            Password
          </label>
          <Input
            id="login-password"
            type="password"
            autoComplete="current-password"
            {...register("password")}
            aria-invalid={!!errors.password}
          />
          {errors.password && (
            <span className="mt-1 text-xs text-destructive">
              {errors.password.message}
            </span>
          )}
        </div>

        {submitError && (
          <Alert variant="destructive">
            <AlertDescription>Error: {submitError}</AlertDescription>
          </Alert>
        )}

        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
          Sign in
        </Button>
      </form>
    </div>
  );
}
