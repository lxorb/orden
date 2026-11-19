use serde::Serialize;
use tauri::AppHandle;

use orden_agents::grants::Grant;
use orden_agents::verbs::{self, Answer, Approval, Code};
use orden_agents::{approvals, shell, state, stop, Caller};

use crate::{browser, capture, tabs};

#[tauri::command(async)]
pub fn agents_state(webview: tauri::Webview, app: AppHandle) -> Result<Overview, String> {
    orden_base::labels::from_the_app(&webview)?;
    let agents = state(&app).grants.all(&app)?;
    let tabs = agents
        .iter()
        .flat_map(|grant| {
            tabs::of(&grant.id)
                .into_iter()
                .map(|tab| (grant.id.clone(), tab.listed()))
                .collect::<Vec<_>>()
        })
        .collect();
    Ok(Overview {
        agents,
        tabs,
        approvals: approvals::pending(None),
        stopped: stop::stopped(),
        halted: stop::halted(),
        connected: shell::connected(),
    })
}
#[derive(Serialize)]
pub struct Overview {
    pub agents: Vec<Grant>,
    pub tabs: Vec<(String, verbs::AgentTab)>,
    pub approvals: Vec<Approval>,
    pub stopped: bool,
    pub halted: Vec<String>,
    pub connected: Vec<String>,
}
#[tauri::command(async)]
pub fn agents_adopt(
    webview: tauri::Webview,
    app: AppHandle,
    agent_tab: String,
    tab: String,
) -> Result<(), String> {
    orden_base::labels::from_the_app(&webview)?;
    tabs::adopt(&app, &agent_tab, &tab)
}
#[tauri::command(async)]
pub fn agents_peek(
    webview: tauri::Webview,
    app: AppHandle,
    tab: String,
) -> Result<verbs::Picture, String> {
    orden_base::labels::from_the_app(&webview)?;
    browser::peek(&app, &tab)
}
#[tauri::command]
pub async fn agents_capture(
    webview: tauri::Webview,
    app: AppHandle,
    agent: Option<String>,
    tab: String,
    shape: verbs::CaptureAs,
    full_page: Option<bool>,
    page: Option<orden_documents::pdf::PdfPage>,
) -> Answer {
    orden_base::lane::off_the_runtime(move || -> Answer {
        if let Err(why) = orden_base::labels::from_the_app(&webview) {
            return Answer::error(Code::NotGranted, why);
        }
        let caller = match agent {
            None => Caller::Reader,
            Some(id) => match state(&app).grants.by_id(&app, &id) {
                Some(grant) => Caller::Agent(Box::new(grant)),
                None => return Answer::error(Code::NotGranted, "there is no such agent"),
            },
        };
        capture::answer(
            &app,
            &caller,
            &tab,
            capture::Asked { shape, full_page: full_page.unwrap_or(false), paper: page },
        )
    })
    .await
}
