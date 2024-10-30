import sharp from "sharp"

async function main() {
    let background = sharp({
        create: {
            width: 1920,
            height: 1080,
            channels: 3,
            background: { r: 255, g: 255, b: 255 }
        }
    }
    )
        .toColourspace('rgb16')
        .tiff({
            compression: 'lzw'
        })
    for (let i = 1; i <= 100; i++) {
        let text = await sharp({
            text: {
                text: i.toString(),
                font: "NotoSans 36",
                dpi: 600
            }
        })
            .negate()
            .tiff()
            .toBuffer()

        await background.clone()
            .composite([{
                input: text,
                top: 200 + i * 20 % 200,
                left: 200 + i * 20 % 200
            }])
            .linear([1, 1, 1], [255, 0, 0])
            .toFile(import.meta.dirname + '/test_' + i + '.tiff')
    }
}

main()