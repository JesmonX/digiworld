import { useState } from 'react'
import { Button, EmptyState, FormField, Input, MasterDetail, Metric, MetricGrid, PageToolbar, Panel, PluginPage, Section, SplitPane, Status } from '@digiworld/design-system/react'

/** A plugin-sized example: all appearance and responsive layout come from the framework. */
export function DesignTemplate() {
  const [selected, setSelected] = useState(false)
  return <PluginPage toolbar={<PageToolbar filters={<Input aria-label="搜索示例" placeholder="搜索内容" />} actions={<Button variant="primary">刷新</Button>} />}>
    <Panel><MetricGrid><Metric label="已完成" value="24" /><Metric label="进行中" value="3" /><Metric label="成功率" value="96%" /></MetricGrid></Panel>
    <SplitPane aside={<Panel><FormField label="名称" hint="设置会保留在当前插件。"><Input placeholder="输入名称" /></FormField></Panel>}>
      <Section title="最近内容" description="此示例没有插件专属样式。"><Panel><MasterDetail selected={selected} onBack={() => setSelected(false)} list={<Button onClick={() => setSelected(true)}>打开示例记录</Button>} detail={selected ? <Status>示例记录详情</Status> : <EmptyState title="选择一条记录" description="查看记录的详细内容。" />} /></Panel></Section>
    </SplitPane>
  </PluginPage>
}
