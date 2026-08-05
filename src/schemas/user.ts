import { z } from "zod";

const passwordField = z.string().min(8, "Password must be at least 8 characters");

export const userCreateFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().min(1, "Email is required").email("Invalid email format"),
  password: passwordField,
});

export const userUpdateFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().min(1, "Email is required").email("Invalid email format"),
});

export type UserCreateFormData = z.infer<typeof userCreateFormSchema>;
export type UserUpdateFormData = z.infer<typeof userUpdateFormSchema>;
