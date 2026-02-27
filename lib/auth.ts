import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

const secretKey = process.env.JWT_SECRET || 'okk-super-secret-key-32-chars-long-min';
const key = new TextEncoder().encode(secretKey);

export async function encrypt(payload: any) {
    return await new SignJWT(payload)
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('24h')
        .sign(key);
}

export async function decrypt(input: string): Promise<any> {
    const { payload } = await jwtVerify(input, key, {
        algorithms: ['HS256'],
    });
    return payload;
}

export async function login(user: { id: string, username: string, role: string, retail_crm_manager_id: number | null }) {
    // 24 hours from now
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const session = await encrypt({ user, expires });

    const cookieStore = cookies();
    cookieStore.set('auth_session', session, { expires, httpOnly: true, secure: process.env.NODE_ENV === 'production' });
}

export async function logout() {
    cookies().set('auth_session', '', { expires: new Date(0), httpOnly: true });
}

export async function getSession() {
    const session = cookies().get('auth_session')?.value;
    if (!session) return null;
    return await decrypt(session);
}

export async function verifyPassword(inputPassword: string, storedPasswordHash: string) {
    // In a real app we would use bcrypt, but per plan we are storing raw text for testing
    // To respect the implementation plan we will compare directly.
    return inputPassword === storedPasswordHash;
}
