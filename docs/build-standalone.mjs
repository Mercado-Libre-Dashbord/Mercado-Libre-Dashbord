// Genera el HTML autocontenido a partir del fuente del artifact.
//
// El fuente (RETAIL-PRODUCTO-COMPLETO.html) no lleva <!doctype>, <html>, <head>
// ni <body> porque el publicador de artifacts los agrega solo. Para mandar el
// documento por mail o abrirlo de un doble click hace falta el archivo entero,
// y este script lo arma para que las dos versiones nunca se desincronicen.
//
//   node docs/build-standalone.mjs
//
// Editá siempre el fuente, nunca la salida.
import { readFileSync, writeFileSync } from "node:fs";

const SRC = "docs/RETAIL-PRODUCTO-COMPLETO.html";
const OUT = "docs/MetricsField_Retail_PRODUCTO_COMPLETO.html";

const src = readFileSync(SRC, "utf8");
const cut = src.indexOf("</style>");
if (cut === -1) throw new Error(`No se encontró </style> en ${SRC}`);

const head = src.slice(0, cut + "</style>".length).trim();
const body = src.slice(cut + "</style>".length).trim();

writeFileSync(
  OUT,
  `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${head}
</head>
<body>

${body}

</body>
</html>
`
);
console.log(`${OUT} generado (${(readFileSync(OUT).length / 1024).toFixed(0)} KB)`);
