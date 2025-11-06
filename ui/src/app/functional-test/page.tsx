"use client";
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { IconPlus } from '../../components/icons';
import './functional-test.css';

type Test = {
  id: string;
  status: string;
  app: string;
  testName: string;
  mobileVersion: string;
  testVersion: string;
  testCategories: string[];
  issuesPending: number;
};

type QuickStartProject = {
  id: string;
  name: string;
  device: 'iOS' | 'Web' | 'Android';
};

// Dummy Quick Start data
const QUICK_START_PROJECTS: QuickStartProject[] = [
  {
    id: '1',
    name: 'Amazon - Fleet Driver',
    device: 'iOS'
  }
];

// Dummy tests data (empty initially)
const DUMMY_TESTS: Test[] = [];

export default function FunctionalTestPage() {
  const router = useRouter();
  const [tests] = useState<Test[]>(DUMMY_TESTS);
  const [quickStartProjects] = useState<QuickStartProject[]>(QUICK_START_PROJECTS);

  const handleCreateNewTest = () => {
    router.push('/configure-functional-test');
  };

  return (
    <>
      {/* Header */}
      <div className="page-header">
        <div className="max-w-7xl mx-auto px-6">
          <h1 className="page-title">Start Automated Testing</h1>

          <button
            className="btn-primary"
            onClick={handleCreateNewTest}
          >
            <IconPlus width={18} height={18} />
            <span>Create new project</span>
          </button>
        </div>
      </div>

      {/* Quick Start Section */}
      <section className="py-6">
        <div className="max-w-7xl mx-auto px-6">
          <h2 className="section-label">Quick Start</h2>

          <div className="quick-start-grid">
            {quickStartProjects.map((project) => (
              <div key={project.id} className="quick-start-card">
                <div className="quick-start-card-header">
                  <span className={`device-badge device-${project.device.toLowerCase()}`}>
                    {project.device}
                  </span>
                </div>
                <p className="quick-start-card-name">{project.name}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Table Section */}
      <section>
        <div className="max-w-7xl mx-auto px-6">
          <div className="tests-table-container">
            <table className="tests-table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>App</th>
                  <th>Test Name</th>
                  <th>Mobile Version</th>
                  <th>Test Version</th>
                  <th>Test Categories</th>
                  <th>No. of Issues pending</th>
                </tr>
              </thead>
              <tbody>
                {tests.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="empty-row">
                      No tests created yet
                    </td>
                  </tr>
                ) : (
                  tests.map((test) => (
                    <tr key={test.id}>
                      <td>{test.status}</td>
                      <td>{test.app}</td>
                      <td>{test.testName}</td>
                      <td>{test.mobileVersion}</td>
                      <td>{test.testVersion}</td>
                      <td>{test.testCategories.join(', ')}</td>
                      <td>{test.issuesPending}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </>
  );
}
