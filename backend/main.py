import io
import re
from flask import Flask, request, jsonify
from flask_cors import CORS
from PIL import Image, ImageEnhance
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


def preprocess_for_ocr(image):
    """
    Artificially boost contrast so Tesseract can 'see' low contrast text.
    This image is ONLY used for finding coordinates, not for color checking.
    """
    gray = image.convert('L')
    enhancer = ImageEnhance.Contrast(gray)
    # A factor of 4.0 aggressively darkens grays and lightens light backgrounds
    return enhancer.enhance(4.0)


def analyze_contrast(image):
    issues = []
    
    # 1. Preprocess the image specifically to help Tesseract find the text
    ocr_image = preprocess_for_ocr(image)
    
    # psm 11 helps find scattered text (like UI elements and buttons)
    custom_config = r'--psm 11'
    ocr_data = pytesseract.image_to_data(ocr_image, output_type=pytesseract.Output.DICT, config=custom_config)

    # 2. Group word-level detections into line-level bounding boxes
    lines = {}
    n_boxes = len(ocr_data['text'])

    for i in range(n_boxes):
        text = ocr_data['text'][i].strip()
        try:
            conf = float(ocr_data['conf'][i])
        except ValueError:
            conf = -1

        if text and conf > 30:
            # Create a unique key for the paragraph/line
            block = ocr_data['block_num'][i]
            par = ocr_data['par_num'][i]
            line = ocr_data['line_num'][i]
            line_key = f"{block}_{par}_{line}"

            x = ocr_data['left'][i]
            y = ocr_data['top'][i]
            w = ocr_data['width'][i]
            h = ocr_data['height'][i]

            if line_key not in lines:
                lines[line_key] = {
                    'x1': x, 'y1': y, 
                    'x2': x + w, 'y2': y + h,
                    'text_parts': [text],
                    'heights': [h] # Track individual word heights for font-size estimation
                }
            else:
                lines[line_key]['x1'] = min(lines[line_key]['x1'], x)
                lines[line_key]['y1'] = min(lines[line_key]['y1'], y)
                lines[line_key]['x2'] = max(lines[line_key]['x2'], x + w)
                lines[line_key]['y2'] = max(lines[line_key]['y2'], y + h)
                lines[line_key]['text_parts'].append(text)
                lines[line_key]['heights'].append(h)

    # Convert our line groupings back into regions
    regions = []
    for line in lines.values():
        regions.append({
            'x': line['x1'],
            'y': line['y1'],
            'w': line['x2'] - line['x1'],
            'h': line['y2'] - line['y1'],
            'text': " ".join(line['text_parts']),
            'max_word_h': max(line['heights']) # More accurate for font size than total box height
        })

    # Create a clean string of all detected text based on our lines
    full_ocr_text = "\n".join([r['text'] for r in regions])

    if not regions:
        return [], full_ocr_text

    width, height = image.size
    gray_image = image.convert('L') # Use original image for color data

    for region in regions:
        x, y, w, h = region['x'], region['y'], region['w'], region['h']

        padding = max(2, w // 6)
        x1 = max(0, x - padding)
        y1 = max(0, y - padding)
        x2 = min(width, x + w + padding)
        y2 = min(height, y + h + padding)

        # Crop from the ORIGINAL un-altered image
        crop = image.crop((x1, y1, x2, y2))
        gray_crop = gray_image.crop((x1, y1, x2, y2))

        gray_pixels = list(gray_crop.getdata())
        if not gray_pixels:
            continue

        threshold = sum(gray_pixels) / len(gray_pixels)

        fg_pixels = []
        bg_pixels = []

        crop_pixels = list(crop.getdata())
        for idx, pixel in enumerate(crop_pixels):
            if len(pixel) == 4:
                pixel = pixel[:3]

            if gray_pixels[idx] < threshold:
                fg_pixels.append(pixel)
            else:
                bg_pixels.append(pixel)

        if not fg_pixels or not bg_pixels:
            continue

        avg_fg = tuple(sum(c[i] for c in fg_pixels) // len(fg_pixels) for i in range(3))
        avg_bg = tuple(sum(c[i] for c in bg_pixels) // len(bg_pixels) for i in range(3))

        l_fg = rgb_to_relative_luminance(*avg_fg)
        l_bg = rgb_to_relative_luminance(*avg_bg)
        ratio = contrast_ratio(l_fg, l_bg)

        # Use the max word height, not the bounding box height, to determine font size
        is_large_text = region['max_word_h'] >= 24

        if ratio < 3:
            issues.append({
                'type': 'contrast',
                'severity': 'critical',
                'text': region['text'][:80], # Increased preview length since it's a full line
                'ratio': round(ratio, 2),
                'required': '3:1 for large text' if is_large_text else '4.5:1 for normal text',
                'actual': f'{ratio:.2f}:1'
            })
        elif ratio < 4.5 and not is_large_text:
            issues.append({
                'type': 'contrast',
                'severity': 'warning',
                'text': region['text'][:80],
                'ratio': round(ratio, 2),
                'required': '4.5:1 for normal text',
                'actual': f'{ratio:.2f}:1'
            })

    return issues, full_ocr_text


def generate_alt_text(ocr_text, issues):
    """Generate draft alt text based on OCR and contrast issues."""
    text = ocr_text.strip() if ocr_text else ''

    if not text:
        if issues:
            return "Image with text that may have low contrast. Review the text content and ensure it meets accessibility standards."
        return "Decorative image or image with no detectable text."

    preview = text.replace('\n', ' ')
    preview = preview[:100] + '...' if len(preview) > 100 else preview
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

    formatted_text = text.replace('\n', ' | ')
    return f"This image contains text: \"{formatted_text[:200]}\".{size_note}{issue_note} Edit this description to capture the full meaning and context of the visual for screen reader users."


@app.route('/analyze', methods=['POST'])
def analyze():
    if 'image' not in request.files:
        return jsonify({'error': 'No image provided'}), 400

    file = request.files['image']
    try:
        image = Image.open(file.stream).convert('RGB')
    except Exception as e:
        return jsonify({'error': f'Invalid image: {str(e)}'}), 400

    # We now get the grouped OCR text directly from our analyzer to ensure parity
    issues, ocr_text = analyze_contrast(image)

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
    app.run(debug=True, port=5001)