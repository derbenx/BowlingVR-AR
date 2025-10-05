from playwright.sync_api import sync_playwright, expect

def run_verification():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Listen for console messages and print more details for errors
        def handle_console(msg):
            if msg.type == "error":
                print(f"Browser Console ERROR: {msg.text} at {msg.location}")
            else:
                print(f"Browser Console: {msg.text}")

        page.on("console", handle_console)

        try:
            # Navigate to the application
            page.goto("http://localhost:8000/index.html?test=true", timeout=10000)

            # Wait for the canvas to be rendered
            canvas = page.locator('canvas')
            expect(canvas).to_be_visible(timeout=10000)

            # Wait for the test-mode-ready flag
            page.wait_for_function("window.testModeReady === true", timeout=10000)

            # Take screenshot for visual verification
            page.screenshot(path="jules-scratch/verification/freeplay_verification.png")
            print("Screenshot captured successfully.")

        except Exception as e:
            print(f"An error occurred during Playwright verification: {e}")
        finally:
            browser.close()

if __name__ == "__main__":
    run_verification()