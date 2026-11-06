import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";

const PROTECTED_API_PREFIXES = ["/api/atelier", "/api/upload", "/api/employees"];

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    if (PROTECTED_API_PREFIXES.some((prefix) => request.nextUrl.pathname.startsWith(prefix))) {
      return NextResponse.json(
        { ok: false, error: { code: "AUTH_CONFIG_ERROR", message: "Authentication service unavailable" } },
        { status: 500 }
      );
    }
    return response;
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({
          request: {
            headers: request.headers,
          },
        });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  const bearerHeader = request.headers.get("authorization");
  const bearerToken =
    bearerHeader && bearerHeader.toLowerCase().startsWith("bearer ")
      ? bearerHeader.slice(7).trim()
      : undefined;

  const {
    data: { user },
  } = bearerToken ? await supabase.auth.getUser(bearerToken) : await supabase.auth.getUser();

  const isProtectedApi = PROTECTED_API_PREFIXES.some((prefix) =>
    request.nextUrl.pathname.startsWith(prefix)
  );

  if (isProtectedApi && !user) {
    return NextResponse.json(
      { ok: false, error: { code: "UNAUTHENTICATED", message: "Authentication required" } },
      { status: 401 }
    );
  }

  return response;
}

export const config = {
  matcher: ["/api/atelier/:path*", "/api/upload/:path*", "/api/employees/:path*"],
};
