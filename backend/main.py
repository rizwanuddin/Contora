import io
import re
from flask import Flask, request, jsonify
from flask_cors import CORS
from PIL import Image
import pytesseract

app = Flask(__name__)
CORS(app)


def rgb_to_relative_luminance(r, g, b):
    def channel(c):
        c = c / 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)


def contrast_ratio(l1, l2):
    lighter = max(l1, l2)
    darker = min(l1, l2)
    return (lighter + 0.05) / (darker + 0.05)


def analyze_contrast(image):
    """Analyze image for contrast issues based on OCR-detected text regions."""
    issues = []
    ocr_data = pytesseract.image_to_data(image, output_type=pytesseract.Output.DICT)

    # Collect unique text regions with their bounding boxes
    regions = []
    n_boxes = len(ocr_data['text'])
    for i in range(n_boxes):
        text = ocr_data['text'][i].strip()
        conf = int(ocr_data['conf'][i])
        if text and conf > 30:
            x = ocr_data['left'][i]
            y = ocr_data['top'][i]
            w = ocr_data['width'][i]
            h = ocr_data['height'][i]
            regions.append({'x': x, 'y': y, 'w': w, 'h': h, 'text': text})

    if not regions:
        return [], None

    # Sample colors from text regions and their surroundings
    width, height = image.size
    for region in regions:
        x, y, w, h = region['x'], region['y'], region['w'], region['h']

        # Expand region slightly to capture background
        padding = max(2, w // 4)
        x1 = max(0, x - padding)
        y1 = max(0, y - padding)
        x2 = min(width, x + w + padding)
        y2 = min(height, y + h + padding)

        text_pixels = []
        bg_pixels = []

        # Sample text pixels (center of region) and background (edges)
        for py in range(y1, y2):
            for px in range(x1, x2):
                pixel = image.getpixel((px, py))
                is_text = x <= px < x + w and y <= py < y + h
                if len(pixel) == 4:
                    pixel = pixel[:3]
                if is_text:
                    text_pixels.append(pixel)
                else:
                    bg_pixels.append(pixel)

        if not text_pixels or not bg_pixels:
            continue

        # Average colors
        avg_text = tuple(sum(c[i] for c in text_pixels) // len(text_pixels) for i in range(3))
        avg_bg = tuple(sum(c[i] for c in bg_pixels) // len(bg_pixels) for i in range(3))

        l_text = rgb_to_relative_luminance(*avg_text)
        l_bg = rgb_to_relative_luminance(*avg_bg)
        ratio = contrast_ratio(l_text, l_bg)

        is_large_text = h >= 18 or (w > 18 and h >= 14)

        if ratio < 3:
            issues.append({
                'type': 'contrast',
                'severity': 'critical',
                'text': region['text'][:50],
                'ratio': round(ratio, 2),
                'required': '3:1 for large text' if is_large_text else '4.5:1 for normal text',
                'actual': f'{ratio:.2f}:1'
            })
        elif ratio < 4.5 and not is_large_text:
            issues.append({
                'type': 'contrast',
                'severity': 'warning',
                'text': region['text'][:50],
                'ratio': round(ratio, 2),
                'required': '4.5:1 for normal text',
                'actual': f'{ratio:.2f}:1'
            })

    return issues, ocr_data['text']


def generate_alt_text(ocr_text, issues):
    """Generate draft alt text based on OCR and contrast issues."""
    text = ocr_text.strip() if ocr_text else ''

    if not text:
        if issues:
            return "Image with text that may have low contrast. Review the text content and ensure it meets accessibility standards."
        return "Decorative image or image with no detectable text."

    preview = text[:100] + '...' if len(text) > 100 else text
    contrast_note = " Caution: text may have contrast issues." if any(i['severity'] == 'critical' for i in issues) else ""

    return f"Text image showing: {preview}.{contrast_note}"


def generate_long_description(ocr_text, issues, image_size):
    """Generate draft long description."""
    text = ocr_text.strip() if ocr_text else ''

    width, height = image_size
    size_note = f" The image is {width}x{height} pixels."

    if not text:
        return f"No text detected in this image.{size_note} Consider adding a description of the visual content for screen readers."

    issue_note = ""
    if issues:
        contrast_issues = [i for i in issues if i['type'] == 'contrast']
        if contrast_issues:
            issue_note = f" Note: {len(contrast_issues)} text region(s) may not meet WCAG contrast requirements (3:1 for large text, 4.5:1 for normal text)."

    return f"This image contains text: \"{text[:200]}\".{size_note}{issue_note} Edit this description to capture the full meaning and context of the visual for screen reader users."


@app.route('/analyze', methods=['POST'])
def analyze():
    if 'image' not in request.files:
        return jsonify({'error': 'No image provided'}), 400

    file = request.files['image']
    try:
        image = Image.open(file.stream).convert('RGB')
    except Exception as e:
        return jsonify({'error': f'Invalid image: {str(e)}'}), 400

    ocr_text = pytesseract.image_to_string(image)
    issues, _ = analyze_contrast(image)

    alt_text = generate_alt_text(ocr_text, issues)
    long_description = generate_long_description(ocr_text, issues, image.size)

    return jsonify({
        'ocr_text': ocr_text,
        'issues': issues,
        'alt_text': alt_text,
        'long_description': long_description
    })


@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok'})


if __name__ == '__main__':
    app.run(debug=True, port=5000)
