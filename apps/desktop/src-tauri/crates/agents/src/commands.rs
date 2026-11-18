use serde_json::Value;
use tauri::AppHandle;

use crate::verbs::{self, Answer, Approval, ApprovalAnswer, Category, Code};
use crate::{approvals, files, log, state, stop, Caller};

#[tauri::command]
pub fn agents_stop(
    webview: tauri::Webview,
    app: AppHandle,
    agent: Option<String>,
) -> Result<bool, String> {
    orden_base::labels::from_the_app(&webview)?;
    Ok(match agent {
        Some(agent) => {
            stop::halt(&app, &agent);
            false
        }
        None => stop::stop(&app),
    })
}

#[tauri::command]
pub fn agents_resume(
    webview: tauri::Webview,
    app: AppHandle,
    agent: Option<String>,
) -> Result<(), String> {
    orden_base::labels::from_the_app(&webview)?;
    stop::resume(&app, agent.as_deref());
    Ok(())
}

#[tauri::command]
pub async fn agents_dialog_path(
    webview: tauri::Webview,
    app: AppHandle,
    agent: String,
    path: String,
    write: bool,
) -> Answer {
    orden_base::lane::off_the_runtime(move || -> Answer {
        if let Err(why) = orden_base::labels::from_the_app(&webview) {
            return Answer::error(Code::NotGranted, why);
        }
        let Some(grant) = state(&app).grants.by_id(&app, &agent) else {
            return Answer::error(Code::NotGranted, "there is no such agent");
        };
        let op = if write {
            verbs::FilesOp::Write
        } else {
            verbs::FilesOp::Read
        };
        match files::reachable(&app, &Caller::Agent(Box::new(grant)), &path, op) {
            Ok(path) => {
                orden_base::paths::picked_for_an_agent(&app, &files::pick_reach(&app, &path));
                Answer::ok(serde_json::json!({ "path": path.display().to_string() }))
            }
            Err(answer) => answer,
        }
    })
    .await
}

#[tauri::command(async)]
pub fn agents_answer(
    webview: tauri::Webview,
    app: AppHandle,
    id: String,
    allow: bool,
    always: bool,
) -> Result<Approval, String> {
    orden_base::labels::from_the_app(&webview)?;
    let approval = approvals::answer(&app, &id, allow)?;
    if always && approval.answer == ApprovalAnswer::Allowed {
        if let Some(site) = approval.site.clone() {
            let category = approval.category;
            let _ = state(&app).grants.change(&app, &approval.agent, |grant| {
                let kept = grant.always.entry(site).or_default();
                if !kept.contains(&category) {
                    kept.push(category);
                }
            });
        }
    }
    Ok(approval)
}

#[tauri::command(async)]
pub fn agents_ask(
    webview: tauri::Webview,
    app: AppHandle,
    agent: String,
    category: Category,
    summary: String,
    key: String,
    site: Option<String>,
) -> Answer {
    if let Err(why) = orden_base::labels::from_the_app(&webview) {
        return Answer::error(Code::NotGranted, why);
    }
    if approvals::allowed(&agent, &key) {
        return Answer::ok(verbs::Nothing {});
    }
    let Some(grant) = state(&app).grants.by_id(&app, &agent) else {
        return Answer::error(Code::NotGranted, "there is no such agent");
    };
    if !grant.asks(category)
        || site
            .as_deref()
            .is_some_and(|site| grant.always(site, category))
    {
        return Answer::ok(verbs::Nothing {});
    }
    approvals::ask(
        &app,
        approvals::Asking {
            agent: &grant.id,
            name: &grant.name,
            category,
            summary,
            site,
            tab: None,
            key,
        },
    )
}

#[tauri::command(async)]
pub fn agents_log(
    webview: tauri::Webview,
    app: AppHandle,
    day: String,
) -> Result<Vec<Value>, String> {
    orden_base::labels::from_the_app(&webview)?;
    Ok(log::read_day(&app, &day))
}

#[tauri::command(async)]
pub fn agents_log_after(
    webview: tauri::Webview,
    app: AppHandle,
    day: String,
    from: u64,
) -> Result<log::After, String> {
    orden_base::labels::from_the_app(&webview)?;
    Ok(log::read_after(&app, &day, from))
}

#[tauri::command(async)]
pub fn agents_log_days(webview: tauri::Webview, app: AppHandle) -> Result<Vec<String>, String> {
    orden_base::labels::from_the_app(&webview)?;
    Ok(log::days(&app))
}

#[tauri::command(async)]
pub fn agents_log_clear(
    webview: tauri::Webview,
    app: AppHandle,
    agent: Option<String>,
) -> Result<(), String> {
    orden_base::labels::from_the_app(&webview)?;
    log::clear(&app, agent.as_deref())
}
