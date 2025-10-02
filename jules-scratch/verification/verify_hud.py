from playwright.sync_api import sync_playwright, expect

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context()
    page = context.new_page()

    try:
        page.goto("http://localhost:8000/?test=true", wait_until="domcontentloaded")

        # Wait for the canvas to appear, indicating the Three.js scene has started.
        canvas = page.locator("canvas")
        expect(canvas).to_be_visible(timeout=10000) # 10 second timeout

        # Wait for the testModeReady flag to be set in the application
        page.wait_for_function("() => window.testModeReady", timeout=10000)

        # Give the scene a moment to fully render the HUD
        page.wait_for_timeout(1000)

        # The HUD should be visible by default. We'll take a screenshot to verify.
        page.screenshot(path="jules-scratch/verification/verification.png")

    except Exception as e:
        print(f"An error occurred: {e}")
        # Save a screenshot on error to help debug
        page.screenshot(path="jules-scratch/verification/error.png")
    finally:
        browser.close()

with sync_playwright() as playwright:
    run(playwright)