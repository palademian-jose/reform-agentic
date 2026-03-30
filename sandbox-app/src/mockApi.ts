export interface SignupPayload {
  name: string;
  email: string;
}

export async function signup(payload: SignupPayload) {
  await new Promise((resolve) => setTimeout(resolve, 800));

  if (!payload.name.trim()) {
    throw new Error("Missing required field `name`.");
  }

  return {
    ok: true,
    redirectTo: "/dashboard",
  };
}
