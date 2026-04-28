/**
 * Dual-Mode Authentication Middleware
 *
 * Mode 1: Behind gateway — trusts X-Internal-Secret + X-User-* headers
 * Mode 2: Standalone — calls auth service via service binding to verify JWT
 */

function errorJson(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

export async function authenticateRequest(request, env) {
  // Mode 1: Behind gateway — trusted internal headers
  const internalSecret = request.headers.get('X-Internal-Secret');
  if (internalSecret && env.INTERNAL_SECRET && internalSecret === env.INTERNAL_SECRET) {
    return {
      user: {
        userId: request.headers.get('X-User-Id'),
        email: request.headers.get('X-User-Email'),
        displayName: request.headers.get('X-User-Name'),
        role: request.headers.get('X-User-Role') || 'member',
        groups: tryParseJson(request.headers.get('X-User-Groups'), []),
        source: request.headers.get('X-User-Source') || 'gateway',
      },
    };
  }

  // Mode 2: Standalone — call auth service to verify JWT
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  if (env.AUTH_SERVICE) {
    try {
      const res = await env.AUTH_SERVICE.fetch(
        new Request('https://auth/verify', {
          headers: { Authorization: authHeader },
        })
      );
      if (!res.ok) return null;
      const payload = await res.json();
      return {
        user: {
          userId: payload.userId,
          email: payload.email,
          displayName: payload.displayName,
          role: payload.role || 'member',
          groups: payload.groups || [],
          source: payload.source,
        },
      };
    } catch {
      return null;
    }
  }

  return null;
}

export async function requireAuth(request, env) {
  const auth = await authenticateRequest(request, env);
  if (!auth) {
    return { auth: null, error: errorJson('Unauthorized', 401) };
  }
  return { auth, error: null };
}

export function requireRole(auth, ...roles) {
  const userRole = auth?.user?.role;

  const hasAccess =
    userRole === 'superadmin' ||
    roles.includes(userRole) ||
    (userRole === 'admin' && roles.includes('trainer')) ||
    (userRole === 'admin' && roles.includes('team_lead'));

  if (!hasAccess) {
    return errorJson('Forbidden', 403);
  }
  return null;
}

function tryParseJson(str, fallback) {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}
