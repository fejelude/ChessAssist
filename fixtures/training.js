import { Chess } from "../node_modules/chess.js/dist/esm/chess.js";
const chess = new Chess(),
  sequence = ["a3", "e5", "f3", "Bc5", "g4", "Qh4#"];
let index = 0;
const $ = (s) => document.querySelector(s),
  images = {};
await Promise.all(
  [..."wb"].flatMap((c) =>
    [..."KQRBNP"].map(async (p) => {
      const img = new Image();
      img.src = `../dist/pieces/${c}${p}.svg`;
      await img.decode();
      images[c + p.toLowerCase()] = img;
    }),
  ),
);
function cells() {
  return Array.from({ length: 64 }, (_, i) => {
    const r = Math.floor(i / 8),
      c = i % 8,
      flip = $("#flip").checked,
      sq = `${"abcdefgh"[flip ? 7 - c : c]}${flip ? r + 1 : 8 - r}`,
      piece = chess.get(sq);
    return { r, c, sq, code: piece ? piece.color + piece.type : undefined };
  });
}
function render() {
  const kind = $("#renderer").value,
    meta = $("#metadata").checked,
    mount = $("#mount");
  mount.replaceChildren();
  const addMetadata = (el) => {
    el.setAttribute("data-orientation", $("#flip").checked ? "black" : "white");
    if (meta) el.setAttribute("data-fen", chess.fen());
  };
  if (kind === "HTML" || kind === "Shadow DOM") {
    const holder = document.createElement("div");
    let root = holder;
    if (kind === "Shadow DOM") {
      root = holder.attachShadow({ mode: "open" });
      const style = document.createElement("style");
      style.textContent =
        ".practice-grid{display:grid;grid-template-columns:repeat(8,1fr);position:relative;width:100%;height:100%}.cell{position:relative;background:#deded0}.dark{background:#7a927d}.cell img{position:absolute;width:100%;height:100%}";
      root.append(style);
    }
    const board = document.createElement("div");
    board.className = "practice-grid";
    board.setAttribute("role", "grid");
    addMetadata(board);
    for (const cell of cells()) {
      const square = document.createElement("div");
      square.className = `cell ${(cell.r + cell.c) % 2 ? "dark" : ""}`;
      if (cell.code) {
        const img = images[cell.code].cloneNode();
        img.className = `piece ${cell.code}`;
        img.setAttribute("data-square", cell.sq);
        square.append(img);
      }
      board.append(square);
    }
    root.append(board);
    mount.append(holder);
  } else if (kind === "SVG") {
    const ns = "http://www.w3.org/2000/svg",
      svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 480 480");
    svg.classList.add("practice-board");
    addMetadata(svg);
    for (const cell of cells()) {
      const rect = document.createElementNS(ns, "rect");
      for (const [k, v] of Object.entries({
        x: cell.c * 60,
        y: cell.r * 60,
        width: 60,
        height: 60,
        fill: (cell.r + cell.c) % 2 ? "#7a927d" : "#deded0",
      }))
        rect.setAttribute(k, v);
      svg.append(rect);
      if (cell.code) {
        const img = document.createElementNS(ns, "image");
        for (const [k, v] of Object.entries({
          x: cell.c * 60,
          y: cell.r * 60,
          width: 60,
          height: 60,
          href: images[cell.code].src,
          "aria-label": `${cell.code} ${cell.sq}`,
        }))
          img.setAttribute(k, v);
        svg.append(img);
      }
    }
    mount.append(svg);
  } else {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 480;
    const ctx = canvas.getContext("2d");
    for (const cell of cells()) {
      ctx.fillStyle = (cell.r + cell.c) % 2 ? "#7a927d" : "#deded0";
      ctx.fillRect(cell.c * 60, cell.r * 60, 60, 60);
      if (cell.code)
        ctx.drawImage(images[cell.code], cell.c * 60, cell.r * 60, 60, 60);
    }
    if (kind === "Image") {
      const image = new Image();
      image.src = canvas.toDataURL();
      addMetadata(image);
      mount.append(image);
    } else if (kind === "WebGL") {
      const out = document.createElement("canvas");
      out.width = out.height = 480;
      const gl = out.getContext("webgl", { preserveDrawingBuffer: true });
      if (!gl) {
        $("#info").textContent = "WebGL unavailable";
        return;
      }
      const shader = (type, source) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, source);
        gl.compileShader(s);
        return s;
      };
      const program = gl.createProgram();
      gl.attachShader(
        program,
        shader(
          gl.VERTEX_SHADER,
          "attribute vec2 p; varying vec2 uv; void main(){gl_Position=vec4(p,0.,1.);uv=vec2((p.x+1.)/2.,(1.-p.y)/2.);}",
        ),
      );
      gl.attachShader(
        program,
        shader(
          gl.FRAGMENT_SHADER,
          "precision mediump float;varying vec2 uv;uniform sampler2D t;void main(){gl_FragColor=texture2D(t,uv);}",
        ),
      );
      gl.linkProgram(program);
      gl.useProgram(program);
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
        gl.STATIC_DRAW,
      );
      const pos = gl.getAttribLocation(program, "p");
      gl.enableVertexAttribArray(pos);
      gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
      gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        canvas,
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      addMetadata(out);
      mount.append(out);
    } else {
      addMetadata(canvas);
      mount.append(canvas);
    }
  }
  $("#fen").textContent = chess.fen();
  $("#info").textContent =
    `${kind} · ${chess.turn() === "w" ? "White" : "Black"} to move · ${index} / ${sequence.length}`;
}
$("#renderer").onchange = render;
$("#metadata").onchange = render;
$("#flip").onchange = render;
$("#next").onclick = () => {
  if (index < sequence.length) chess.move(sequence[index++]);
  render();
};
$("#reset").onclick = () => {
  chess.reset();
  index = 0;
  render();
};
window.fixture = {
  render,
  chess,
  setFen(fen) {
    chess.load(fen);
    render();
  },
};
render();
