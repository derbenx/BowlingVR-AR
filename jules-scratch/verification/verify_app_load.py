from playwright.sync_api import sync_playwright, expect, Page

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page()

    try:
        page.goto("http://localhost:8000", timeout=10000)
        ar_button = page.get_by_role("button", name="Enter AR")
        expect(ar_button).to_be_visible(timeout=10000)
        page.screenshot(path="jules-scratch/verification/verification.png")
        print("Screenshot taken successfully.")
    except Exception as e:
        print(f"An error occurred: {e}")
        page.screenshot(path="jules-scratch/verification/error.png")
    finally:
        browser.close()

with sync_playwright() as playwright:
    run(playwright)
