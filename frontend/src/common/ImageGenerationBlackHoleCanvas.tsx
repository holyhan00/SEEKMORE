import { resolveAssetUrl } from '../utils/asset-url';
                                                         

import {
  useEffect,
  useRef,
} from 'react';

const BLACK_HOLE_TEXTURE_URL =
  resolveAssetUrl('/effects/image-generation-black-hole.webp');

const EFFECT_BLUR_PX = 30;

interface ImageGenerationBlackHoleCanvasProps {
  className?: string;
  opacity?: number;
}

export default function ImageGenerationBlackHoleCanvas({
  className = '',
  opacity = 1,
}: ImageGenerationBlackHoleCanvasProps) {
  const canvasRef =
    useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas =
      canvasRef.current;

    if (!canvas) {
      return undefined;
    }

    const gl = canvas.getContext(
      'webgl',
      {
        alpha: true,
        antialias: true,
        premultipliedAlpha: false,
        preserveDrawingBuffer: false,
        powerPreference: 'high-performance',
      },
    );

    if (!gl) {
      console.error(
        '[ImageGenerationBlackHoleCanvas] WebGL unavailable. Static image fallback is active.',
      );

      return undefined;
    }

    let disposed = false;
    let frameId = 0;
    let textureReady = false;

    let textureWidth = 1;
    let textureHeight = 1;

    let program:
      | WebGLProgram
      | null = null;

    let positionBuffer:
      | WebGLBuffer
      | null = null;

    let texture:
      | WebGLTexture
      | null = null;

    let resizeObserver:
      | ResizeObserver
      | null = null;

    const vertexSource = `
      attribute vec2 a_position;

      varying vec2 v_uv;

      void main() {
        v_uv =
          a_position * 0.5 + 0.5;

        gl_Position = vec4(
          a_position,
          0.0,
          1.0
        );
      }
    `;

    const fragmentSource = `
      precision highp float;

      uniform sampler2D u_texture;
      uniform vec2 u_resolution;
      uniform vec2 u_texture_size;
      uniform float u_time;

      varying vec2 v_uv;

      float hash21(vec2 p) {
        p = fract(
          p * vec2(
            123.34,
            345.45
          )
        );

        p += dot(
          p,
          p + 34.345
        );

        return fract(
          p.x * p.y
        );
      }

      float noise2(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);

        f =
          f * f
          * (
            3.0
            - 2.0 * f
          );

        float a =
          hash21(i);

        float b =
          hash21(
            i + vec2(
              1.0,
              0.0
            )
          );

        float c =
          hash21(
            i + vec2(
              0.0,
              1.0
            )
          );

        float d =
          hash21(
            i + vec2(
              1.0,
              1.0
            )
          );

        return mix(
          mix(
            a,
            b,
            f.x
          ),
          mix(
            c,
            d,
            f.x
          ),
          f.y
        );
      }

      float fbm(vec2 p) {
        float value = 0.0;
        float amplitude = 0.5;

        for (
          int index = 0;
          index < 5;
          index++
        ) {
          value +=
            amplitude
            * noise2(p);

          p =
            p * 2.03
            + vec2(
              17.17,
              9.23
            );

          amplitude *= 0.5;
        }

        return value;
      }

      vec2 coverTextureUv(
        vec2 screenUv
      ) {
        float containerAspect =
          u_resolution.x
          / max(
              u_resolution.y,
              1.0
            );

        float textureAspect =
          u_texture_size.x
          / max(
              u_texture_size.y,
              1.0
            );

        vec2 textureUv =
          screenUv;

        if (
          containerAspect
          > textureAspect
        ) {
          float visibleHeight =
            textureAspect
            / containerAspect;

          textureUv.y =
            (
              screenUv.y - 0.5
            ) * visibleHeight
            + 0.5;
        } else {
          float visibleWidth =
            containerAspect
            / textureAspect;

          textureUv.x =
            (
              screenUv.x - 0.5
            ) * visibleWidth
            + 0.5;
        }

        return textureUv;
      }

      vec4 sampleCoveredTexture(
        vec2 screenUv
      ) {
        vec2 textureUv =
          coverTextureUv(
            screenUv
          );

        vec3 textureColor =
          texture2D(
            u_texture,
            clamp(
              textureUv,
              vec2(0.001),
              vec2(0.999)
            )
          ).rgb;

        return vec4(
          textureColor,
          1.0
        );
      }

      void main() {
        float aspect =
          u_resolution.x
          / max(
              u_resolution.y,
              1.0
            );

        vec2 center =
          vec2(
            0.5,
            0.5
          );

        vec2 p =
          v_uv - center;

        p.x *= aspect;

        float radius =
          length(p);

        float angle =
          atan(
            p.y,
            p.x
          );

        float slowTime =
          u_time * 0.16;

        float firstNoise =
          fbm(
            p * 3.6
            + vec2(
              slowTime,
              -slowTime * 0.72
            )
          );

        float secondNoise =
          fbm(
            p * 5.2
            + vec2(
              -slowTime * 0.61,
              slowTime * 0.84
            )
          );

        float thirdNoise =
          fbm(
            p * 8.0
            + vec2(
              slowTime * 0.34,
              slowTime * 0.28
            )
          );

        float centerInfluence =
          1.0
          - smoothstep(
              0.10,
              0.92,
              radius
            );

        float pulse =
          sin(
            u_time * 0.52
            + firstNoise
              * 6.283185
          );

        float swirl =
          centerInfluence
          * (
            0.16
            + pulse * 0.055
            + (
                firstNoise - 0.5
              ) * 0.09
          );

        float warpedAngle =
          angle
          + swirl
          + sin(
              angle * 3.0
              - u_time * 0.30
            )
            * 0.025
            * centerInfluence;

        float radialStretch =
          1.0
          + (
              firstNoise - 0.5
            ) * 0.13
          + sin(
              angle * 4.0
              - u_time * 0.36
            ) * 0.035;

        vec2 warpedPosition =
          vec2(
            cos(warpedAngle),
            sin(warpedAngle)
          )
          * radius
          * radialStretch;

        vec2 flowDirection =
          vec2(
            firstNoise - 0.5,
            secondNoise - 0.5
          );

        flowDirection +=
          vec2(
            sin(
              p.y * 15.0
              + u_time * 0.40
            ),
            cos(
              p.x * 14.0
              - u_time * 0.36
            )
          ) * 0.12;

        warpedPosition +=
          flowDirection
          * 0.075
          * (
            0.32
            + centerInfluence
          );

        warpedPosition.x /=
          aspect;

        vec2 warpedUv =
          center
          + warpedPosition;

        vec2 safeFlowDirection =
          flowDirection
          + vec2(0.0001);

        vec2 smearDirection =
          normalize(
            safeFlowDirection
          )
          * 0.007;

        vec4 mainSample =
          sampleCoveredTexture(
            warpedUv
          );

        vec4 forwardSample =
          sampleCoveredTexture(
            warpedUv
            + smearDirection
          );

        vec4 backwardSample =
          sampleCoveredTexture(
            warpedUv
            - smearDirection
          );

        vec4 farForwardSample =
          sampleCoveredTexture(
            warpedUv
            + smearDirection * 2.0
          );

        vec4 farBackwardSample =
          sampleCoveredTexture(
            warpedUv
            - smearDirection * 2.0
          );

        vec3 color =
          mainSample.rgb * 0.46
          + forwardSample.rgb * 0.18
          + backwardSample.rgb * 0.18
          + farForwardSample.rgb * 0.09
          + farBackwardSample.rgb * 0.09;

        float sampleMask =
          mainSample.a * 0.46
          + forwardSample.a * 0.18
          + backwardSample.a * 0.18
          + farForwardSample.a * 0.09
          + farBackwardSample.a * 0.09;

        float liquidHighlight =
          smoothstep(
            0.58,
            0.92,
            firstNoise
          )
          * centerInfluence;

        color +=
          color
          * liquidHighlight
          * 0.10;

        float textureMovement =
          (
            thirdNoise - 0.5
          ) * 0.025;

        color +=
          textureMovement;

        color = pow(
          max(
            color,
            vec3(0.0)
          ),
          vec3(0.96)
        );

        float edgeFade =
          smoothstep(
            0.0,
            0.08,
            sampleMask
          );

        gl_FragColor = vec4(
          color,
          edgeFade * 0.90
        );
      }
    `;

    const createShader = (
      type: number,
      source: string,
    ): WebGLShader => {
      const shader =
        gl.createShader(type);

      if (!shader) {
        throw new Error(
          'IMAGE_GENERATION_BLACK_HOLE_SHADER_CREATE_FAILED',
        );
      }

      gl.shaderSource(
        shader,
        source,
      );

      gl.compileShader(shader);

      if (
        !gl.getShaderParameter(
          shader,
          gl.COMPILE_STATUS,
        )
      ) {
        const shaderType =
          type === gl.VERTEX_SHADER
            ? 'vertex'
            : 'fragment';

        const error =
          gl.getShaderInfoLog(shader)
          || 'Unknown shader compile error';

        console.error(
          `[ImageGenerationBlackHoleCanvas] ${shaderType} shader compilation failed.`,
          error,
        );

        gl.deleteShader(shader);

        throw new Error(error);
      }

      return shader;
    };

    const createProgram = (
      vertexShader: WebGLShader,
      fragmentShader: WebGLShader,
    ): WebGLProgram => {
      const nextProgram =
        gl.createProgram();

      if (!nextProgram) {
        throw new Error(
          'IMAGE_GENERATION_BLACK_HOLE_PROGRAM_CREATE_FAILED',
        );
      }

      gl.attachShader(
        nextProgram,
        vertexShader,
      );

      gl.attachShader(
        nextProgram,
        fragmentShader,
      );

      gl.linkProgram(
        nextProgram,
      );

      if (
        !gl.getProgramParameter(
          nextProgram,
          gl.LINK_STATUS,
        )
      ) {
        const error =
          gl.getProgramInfoLog(
            nextProgram,
          )
          || 'Unknown program link error';

        console.error(
          '[ImageGenerationBlackHoleCanvas] Program link failed.',
          error,
        );

        gl.deleteProgram(
          nextProgram,
        );

        throw new Error(error);
      }

      return nextProgram;
    };

    try {
      const vertexShader =
        createShader(
          gl.VERTEX_SHADER,
          vertexSource,
        );

      const fragmentShader =
        createShader(
          gl.FRAGMENT_SHADER,
          fragmentSource,
        );

      program =
        createProgram(
          vertexShader,
          fragmentShader,
        );

      gl.deleteShader(
        vertexShader,
      );

      gl.deleteShader(
        fragmentShader,
      );
    } catch (error) {
      console.error(
        '[ImageGenerationBlackHoleCanvas] WebGL setup failed. Static image fallback is active.',
        error,
      );

      return undefined;
    }

    if (!program) {
      return undefined;
    }

    const positionLocation =
      gl.getAttribLocation(
        program,
        'a_position',
      );

    const textureLocation =
      gl.getUniformLocation(
        program,
        'u_texture',
      );

    const resolutionLocation =
      gl.getUniformLocation(
        program,
        'u_resolution',
      );

    const textureSizeLocation =
      gl.getUniformLocation(
        program,
        'u_texture_size',
      );

    const timeLocation =
      gl.getUniformLocation(
        program,
        'u_time',
      );

    positionBuffer =
      gl.createBuffer();

    if (!positionBuffer) {
      console.error(
        '[ImageGenerationBlackHoleCanvas] Position buffer creation failed.',
      );

      gl.deleteProgram(program);

      return undefined;
    }

    gl.bindBuffer(
      gl.ARRAY_BUFFER,
      positionBuffer,
    );

    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([
        -1, -1,
         1, -1,
        -1,  1,

        -1,  1,
         1, -1,
         1,  1,
      ]),
      gl.STATIC_DRAW,
    );

    texture =
      gl.createTexture();

    if (!texture) {
      console.error(
        '[ImageGenerationBlackHoleCanvas] Texture creation failed.',
      );

      gl.deleteBuffer(
        positionBuffer,
      );

      gl.deleteProgram(
        program,
      );

      return undefined;
    }

    gl.bindTexture(
      gl.TEXTURE_2D,
      texture,
    );

    gl.texParameteri(
      gl.TEXTURE_2D,
      gl.TEXTURE_WRAP_S,
      gl.CLAMP_TO_EDGE,
    );

    gl.texParameteri(
      gl.TEXTURE_2D,
      gl.TEXTURE_WRAP_T,
      gl.CLAMP_TO_EDGE,
    );

    gl.texParameteri(
      gl.TEXTURE_2D,
      gl.TEXTURE_MIN_FILTER,
      gl.LINEAR,
    );

    gl.texParameteri(
      gl.TEXTURE_2D,
      gl.TEXTURE_MAG_FILTER,
      gl.LINEAR,
    );

    gl.clearColor(
      0,
      0,
      0,
      0,
    );

    const resizeCanvas = () => {
      const rect =
        canvas.getBoundingClientRect();

      const dpr =
        Math.min(
          window.devicePixelRatio || 1,
          1.5,
        );

      const width =
        Math.max(
          1,
          Math.round(
            rect.width * dpr,
          ),
        );

      const height =
        Math.max(
          1,
          Math.round(
            rect.height * dpr,
          ),
        );

      if (
        canvas.width !== width
        || canvas.height !== height
      ) {
        canvas.width = width;
        canvas.height = height;
      }

      gl.viewport(
        0,
        0,
        width,
        height,
      );
    };

    const startTime =
      performance.now();

    const renderScene = (
      now: number,
    ) => {
      if (
        disposed
        || !textureReady
        || !program
        || !positionBuffer
        || !texture
      ) {
        return;
      }

      resizeCanvas();

      const elapsed =
        Math.max(
          0,
          (
            now - startTime
          ) / 1000,
        );

      gl.clear(
        gl.COLOR_BUFFER_BIT,
      );

      gl.useProgram(program);

      gl.bindBuffer(
        gl.ARRAY_BUFFER,
        positionBuffer,
      );

      gl.enableVertexAttribArray(
        positionLocation,
      );

      gl.vertexAttribPointer(
        positionLocation,
        2,
        gl.FLOAT,
        false,
        0,
        0,
      );

      gl.activeTexture(
        gl.TEXTURE0,
      );

      gl.bindTexture(
        gl.TEXTURE_2D,
        texture,
      );

      if (
        textureLocation !== null
      ) {
        gl.uniform1i(
          textureLocation,
          0,
        );
      }

      if (
        resolutionLocation !== null
      ) {
        gl.uniform2f(
          resolutionLocation,
          canvas.width,
          canvas.height,
        );
      }

      if (
        textureSizeLocation !== null
      ) {
        gl.uniform2f(
          textureSizeLocation,
          textureWidth,
          textureHeight,
        );
      }

      if (
        timeLocation !== null
      ) {
        gl.uniform1f(
          timeLocation,
          elapsed,
        );
      }

      gl.drawArrays(
        gl.TRIANGLES,
        0,
        6,
      );

      const drawError =
        gl.getError();

      if (
        drawError !== gl.NO_ERROR
      ) {
        console.error(
          '[ImageGenerationBlackHoleCanvas] WebGL draw failed.',
          drawError,
        );

        return;
      }
    };

    const stopLoop = () => {
      if (!frameId) {
        return;
      }

      window.cancelAnimationFrame(
        frameId,
      );

      frameId = 0;
    };

    const renderLoop = (
      now: number,
    ) => {
      frameId = 0;

      if (disposed) {
        return;
      }

      renderScene(now);

      if (textureReady) {
        frameId =
          window.requestAnimationFrame(
            renderLoop,
          );
      }
    };

    const startLoop = () => {
      if (
        disposed
        || !textureReady
        || frameId
      ) {
        return;
      }

      frameId =
        window.requestAnimationFrame(
          renderLoop,
        );
    };

    const textureImage =
      new Image();

    textureImage.decoding =
      'async';

    textureImage.onload = () => {
      if (
        disposed
        || !texture
      ) {
        return;
      }

      try {
        textureWidth =
          textureImage.naturalWidth
          || textureImage.width
          || 1;

        textureHeight =
          textureImage.naturalHeight
          || textureImage.height
          || 1;

        gl.pixelStorei(
          gl.UNPACK_FLIP_Y_WEBGL,
          true,
        );

        gl.bindTexture(
          gl.TEXTURE_2D,
          texture,
        );

        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          textureImage,
        );

        const uploadError =
          gl.getError();

        if (
          uploadError !== gl.NO_ERROR
        ) {
          console.error(
            '[ImageGenerationBlackHoleCanvas] Texture upload failed.',
            uploadError,
          );

          return;
        }

        textureReady = true;

        renderScene(
          performance.now(),
        );

        startLoop();
      } catch (error) {
        console.error(
          '[ImageGenerationBlackHoleCanvas] Texture setup failed.',
          error,
        );
      }
    };

    textureImage.onerror = (
      event,
    ) => {
      console.error(
        '[ImageGenerationBlackHoleCanvas] Texture load failed.',
        BLACK_HOLE_TEXTURE_URL,
        event,
      );
    };

    textureImage.src =
      BLACK_HOLE_TEXTURE_URL;

    if (
      typeof ResizeObserver
      === 'function'
    ) {
      resizeObserver =
        new ResizeObserver(() => {
          resizeCanvas();

          if (
            textureReady
            && !frameId
          ) {
            renderScene(
              performance.now(),
            );
          }
        });

      resizeObserver.observe(
        canvas,
      );
    }

    const handleContextLost = (
      event: Event,
    ) => {
      event.preventDefault();

      stopLoop();

      console.error(
        '[ImageGenerationBlackHoleCanvas] WebGL context lost. Static fallback is active.',
      );
    };

    canvas.addEventListener(
      'webglcontextlost',
      handleContextLost,
    );

    resizeCanvas();

    return () => {
      disposed = true;

      stopLoop();

      canvas.removeEventListener(
        'webglcontextlost',
        handleContextLost,
      );

      resizeObserver?.disconnect();

      gl.bindTexture(
        gl.TEXTURE_2D,
        null,
      );

      gl.bindBuffer(
        gl.ARRAY_BUFFER,
        null,
      );

      gl.useProgram(null);

      if (texture) {
        gl.deleteTexture(texture);
      }

      if (positionBuffer) {
        gl.deleteBuffer(
          positionBuffer,
        );
      }

      if (program) {
        gl.deleteProgram(program);
      }
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={[
        'pointer-events-none absolute inset-0 block h-full w-full',
        className,
      ].join(' ').trim()}
      style={{
        width: '100%',
        height: '100%',
        display: 'block',
        opacity,
        backgroundColor: '#000000',
        backgroundImage:
          `linear-gradient(
            rgba(0, 0, 0, 0.28),
            rgba(0, 0, 0, 0.28)
          ), url("${BLACK_HOLE_TEXTURE_URL}")`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        filter:
          `blur(${EFFECT_BLUR_PX}px)`,
        WebkitFilter:
          `blur(${EFFECT_BLUR_PX}px)`,
      }}
    />
  );
}