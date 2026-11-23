// Adapted from niels747/2D-Weather-Sandbox lightningGenerator.js,
// commit 0fe98cf10bc844a41e3c5cdb91b897dfe2080e5f (GPL-3.0).
// Original paths and brightness retained; a narrower stroke is used for the displayed channel.
function generateUpstreamLightningBolt(width, height, logicalScale = 1, channelWidthScale = 0.7)
{
  const pixelWidth = width, pixelHeight = height;
  width /= logicalScale;
  height /= logicalScale;
  const lightningCanvas = new OffscreenCanvas(pixelWidth, pixelHeight);
  const ctx = lightningCanvas.getContext('2d', {willReadFrequently : true});

  ctx.clearRect(0, 0, pixelWidth, pixelHeight);
  if (logicalScale !== 1) ctx.scale(logicalScale, logicalScale);


  function genLightningColor(lineWidth)
  {
    const colR = 12;
    const colG = 12;
    const colB = 12;
    const brightness = Math.pow(lineWidth, 2.0);
    return `rgb(${colR * brightness}, ${colG * brightness}, ${colB * brightness})`;
  }


  ctx.beginPath();

  let startX = width / 2.0;
  let startY = 0;
  let angle = Math.PI / 6.;
  let lineWidth = 9.0;
  const targetAngle = 0.0;

  ctx.moveTo(startX, startY);

  ctx.lineWidth = lineWidth * channelWidthScale;

  while (startY < height) {

    const nextX = startX + Math.sin(angle);
    const nextY = startY + Math.cos(angle);

    angle += (Math.random() - 0.5) * 1.4;  // 0.7

    angle -= (angle - targetAngle) * 0.08; // keep it going in a general direction

    ctx.lineTo(nextX, nextY);

    startX = nextX;
    startY = nextY;


    if (Math.random() < 0.015 * (1. - nextY / height)) { // branch
      ctx.strokeStyle = genLightningColor(lineWidth);
      ctx.stroke();
      drawBranch(nextX, nextY, targetAngle + (Math.random() - 0.5) * 2.5, lineWidth * 0.5 * Math.random());
      ctx.beginPath();
      ctx.moveTo(nextX, nextY); // move back to last position after drawing branch
      ctx.lineWidth = lineWidth * channelWidthScale;
    }
  }
  ctx.strokeStyle = genLightningColor(lineWidth);
  ctx.stroke();


  return ctx.getImageData(0, 0, pixelWidth, pixelHeight);


  function drawBranch(startX, startY, targetAngle, line_width)
  {
    let angle = targetAngle;

    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineWidth = line_width * channelWidthScale;

    while (startY < height) {

      const nextX = startX + Math.sin(angle);
      const nextY = startY + Math.cos(angle);

      angle += (Math.random() - 0.5) * 0.7;

      angle -= (angle - targetAngle) * 0.08; // keep it going in a general direction

      ctx.lineTo(nextX, nextY);

      startX = nextX;
      startY = nextY;

      if (Math.random() < 0.018) { // reduce width

        ctx.strokeStyle = genLightningColor(line_width);
        ctx.stroke();
        line_width -= 0.2;

        if (line_width < 0.1)
          return;

        if (Math.random() < 0.1) { // branch 0.005

          drawBranch(nextX, nextY, targetAngle + (Math.random() - 0.5) * 1.5, line_width);
        }

        ctx.beginPath();
        ctx.moveTo(nextX, nextY); // move back to last position after drawing branch
        ctx.lineWidth = line_width * channelWidthScale;
      }
    }
    ctx.strokeStyle = genLightningColor(line_width);
    ctx.stroke();
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = {generateUpstreamLightningBolt};
