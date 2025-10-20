import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#ffffff',
          borderRadius: 32,
        }}
      >
        <div
          style={{
            width: 144,
            height: 144,
            display: 'grid',
            placeItems: 'center',
            borderRadius: 28,
            background: 'linear-gradient(135deg, #0C66E4, #1D7AFC)',
            color: '#ffffff',
            fontSize: 86,
            fontWeight: 900,
          }}
        >
          s
        </div>
      </div>
    ),
    { ...size }
  );
}


