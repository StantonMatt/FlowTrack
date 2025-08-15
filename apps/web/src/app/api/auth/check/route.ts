import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const demoCookie = request.cookies.get('demo_auth');
  const allCookies = request.cookies.getAll();
  
  return NextResponse.json({
    hasDemoCookie: !!demoCookie,
    demoCookieValue: demoCookie?.value,
    allCookies: allCookies.map(c => ({ name: c.name, value: c.value })),
    headers: {
      cookie: request.headers.get('cookie'),
    }
  });
}