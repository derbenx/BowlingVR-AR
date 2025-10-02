from playwright.sync_api import sync_playwright, Page, expect

def verify_app_loads(page: Page):
    """
    This test verifies that the main application script loads and executes
    without syntax errors by checking for the "AR NOT SUPPORTED" text
    that appears in a headless browser environment.
    """
    # 1. Arrange: Go to the application's homepage.
    # The server is running on port 8000.
    page.goto("http://localhost:8000/")

    # 2. Assert: Check for the fallback text displayed by ARButton.js.
    # Its presence indicates that the scripts, including our modified main.js,
    # have loaded and run without fatal errors.
    ar_not_supported_text = page.get_by_text("AR NOT SUPPORTED")
    expect(ar_not_supported_text).to_be_visible(timeout=10000) # Increased timeout for initial load

    # 3. Screenshot: Capture the result for visual verification.
    page.screenshot(path="jules-scratch/verification/verification.png")

def main():
    """
    Main function to run the Playwright verification.
    """
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        verify_app_loads(page)
        browser.close()

if __name__ == "__main__":
    main()